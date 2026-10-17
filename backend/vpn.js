'use strict';

const { execFile } = require('node:child_process');
const { splitTerse } = require('./network-status');

/** @typedef {{ id: 'tailscale'|'surfshark', label: string, available: boolean, connected: boolean, busy: boolean, detail?: string, error?: string }} VpnStatus */

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._@+-]{0,63}$/;
const WINDOWS_TAILSCALE = 'C:\\Program Files\\Tailscale\\tailscale.exe';

/** Connection profile names are passed as a single argv entry (never a shell), but are still validated strictly. */
function isSafeProfileName(name) {
  return typeof name === 'string' && PROFILE_PATTERN.test(name);
}

/** `tailscale status --json` -> { state, connected, detail }. */
function parseTailscaleStatus(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { state: 'Unknown', connected: false, detail: undefined, error: 'Unreadable Tailscale status' }; }
  const state = typeof data.BackendState === 'string' ? data.BackendState : 'Unknown';
  const address = Array.isArray(data.Self?.TailscaleIPs) ? data.Self.TailscaleIPs.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) : undefined;
  const name = typeof data.Self?.HostName === 'string' ? data.Self.HostName : undefined;
  const detail = [name, address].filter(Boolean).join(' · ') || undefined;
  const error = state === 'NeedsLogin' || state === 'NeedsMachineAuth' ? 'Sign in required: run "tailscale up" once on this device' : undefined;
  return { state, connected: state === 'Running', detail, error };
}

/** `nmcli -t -f NAME,TYPE,DEVICE connection show` -> [{ name, type, device, active }] */
function parseNmcliConnections(text) {
  return String(text).split(/\r?\n/).filter(Boolean).map(splitTerse).filter((fields) => fields.length >= 3)
    .map(([name, type, device]) => ({ name, type, device, active: Boolean(device) }));
}

/** Configured profile wins; otherwise the first WireGuard connection whose name mentions Surfshark. */
function findSurfsharkProfile(connections, configured) {
  if (configured) {
    if (!isSafeProfileName(configured)) return { error: 'Configured Surfshark profile name is not valid' };
    const match = connections.find((entry) => entry.name === configured);
    return match ? { profile: match } : { error: `NetworkManager has no connection named "${configured}"` };
  }
  const match = connections.find((entry) => entry.type === 'wireguard' && /surfshark/i.test(entry.name) && isSafeProfileName(entry.name));
  return match ? { profile: match } : { error: 'No Surfshark WireGuard profile in NetworkManager (import one or set settings.vpn.surfsharkWireguardProfile)' };
}

/** Maps process failures to messages that are safe and useful on a TV screen. */
function friendlyError(error, tool) {
  if (error?.code === 'ENOENT') return `${tool} is not installed or not in PATH`;
  if (error?.killed || error?.code === 'ETIMEDOUT') return `${tool} timed out`;
  const text = `${error?.stderr || ''} ${error?.message || ''}`;
  if (/not authori[sz]ed|permission denied|access denied|insufficient privileges|polkit|operator|must be root|sudo/i.test(text)) {
    return tool === 'tailscale'
      ? 'Permission denied: run "sudo tailscale set --operator=$USER" once'
      : 'Permission denied: allow your user to manage NetworkManager connections (see polkit rule in README)';
  }
  if (/login|auth url|https:\/\/login\.tailscale/i.test(text)) return 'Sign in required: run "tailscale up" once on this device';
  const first = String(error?.stderr || error?.message || '').split(/\r?\n/).find((line) => line.trim());
  return first ? first.trim().slice(0, 160) : `${tool} failed`;
}

function run(file, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024, shell: false }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr || ''); error.stdout = String(stdout || ''); reject(error); } else resolve(String(stdout));
    });
  });
}

class VpnService {
  /**
   * @param {{ platform?: string, exec?: (file: string, args: string[], timeout?: number) => Promise<string>, getProfile?: () => string|undefined }} options
   */
  constructor({ platform = process.platform, exec = run, getProfile = () => undefined } = {}) {
    this.platform = platform;
    this.exec = exec;
    this.getProfile = getProfile;
    this.busy = new Set();
    this.errors = new Map();
  }

  get tailscaleBinary() { return this.platform === 'win32' ? 'tailscale.exe' : 'tailscale'; }

  /** Runs tailscale, retrying the default Windows install directory when the binary is not on PATH. */
  async tailscale(args, timeout) {
    try { return await this.exec(this.tailscaleBinary, args, timeout); }
    catch (error) {
      if (error?.code === 'ENOENT' && this.platform === 'win32') return this.exec(WINDOWS_TAILSCALE, args, timeout);
      throw error;
    }
  }

  async tailscaleStatus() {
    const base = { id: 'tailscale', label: 'Tailscale', busy: this.busy.has('tailscale') };
    try {
      const parsed = parseTailscaleStatus(await this.tailscale(['status', '--json'], 5000));
      return { ...base, available: true, connected: parsed.connected, detail: parsed.detail, error: this.errors.get('tailscale') || parsed.error };
    } catch (error) {
      // `tailscale status` exits non-zero while stopped on some versions but still prints JSON.
      if (error?.stdout || error?.code !== 'ENOENT') {
        try {
          const parsed = parseTailscaleStatus(error.stdout || '');
          if (parsed.state !== 'Unknown') return { ...base, available: true, connected: parsed.connected, detail: parsed.detail, error: this.errors.get('tailscale') || parsed.error };
        } catch { /* fall through */ }
      }
      return { ...base, available: false, connected: false, error: friendlyError(error, 'tailscale') };
    }
  }

  async surfsharkStatus() {
    const base = { id: 'surfshark', label: 'Surfshark', busy: this.busy.has('surfshark') };
    if (this.platform === 'win32') return { ...base, available: false, connected: false, error: 'Surfshark WireGuard control is not supported on Windows' };
    try {
      const connections = parseNmcliConnections(await this.exec('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show'], 5000));
      const { profile, error } = findSurfsharkProfile(connections, this.getProfile());
      if (!profile) return { ...base, available: false, connected: false, error };
      return { ...base, available: true, connected: profile.active, detail: profile.name, error: this.errors.get('surfshark') };
    } catch (error) {
      return { ...base, available: false, connected: false, error: friendlyError(error, 'nmcli') };
    }
  }

  /** @returns {Promise<VpnStatus[]>} */
  async list() {
    const results = await Promise.all([this.tailscaleStatus(), this.surfsharkStatus()]);
    return results.map((entry) => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)));
  }

  /** Connects or disconnects one VPN. Failures are reported through the returned list's `error`, never thrown. */
  async toggle(id, enabled) {
    if (id !== 'tailscale' && id !== 'surfshark') throw new Error('Unknown VPN');
    const wanted = Boolean(enabled);
    if (this.busy.has(id)) return this.list();
    this.busy.add(id);
    this.errors.delete(id);
    try {
      if (id === 'tailscale') await this.tailscale([wanted ? 'up' : 'down'], 20000);
      else await this.toggleSurfshark(wanted);
    } catch (error) {
      this.errors.set(id, friendlyError(error, id === 'tailscale' ? 'tailscale' : 'nmcli'));
    } finally { this.busy.delete(id); }
    return this.list();
  }

  async toggleSurfshark(wanted) {
    if (this.platform === 'win32') throw new Error('Surfshark WireGuard control is not supported on Windows');
    const connections = parseNmcliConnections(await this.exec('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show'], 5000));
    const { profile, error } = findSurfsharkProfile(connections, this.getProfile());
    if (!profile) throw new Error(error);
    await this.exec('nmcli', ['connection', wanted ? 'up' : 'down', 'id', profile.name], 20000);
  }
}

module.exports = { VpnService, isSafeProfileName, parseTailscaleStatus, parseNmcliConnections, findSurfsharkProfile, friendlyError, run };
