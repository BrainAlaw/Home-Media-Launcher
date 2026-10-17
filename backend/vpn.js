'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { splitTerse } = require('./network-status');

/** @typedef {{ id: 'tailscale'|'surfshark', label: string, available: boolean, connected: boolean, busy: boolean, detail?: string, error?: string, mode?: string }} VpnStatus */

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._@+-]{0,63}$/;
const SURFSHARK_MODES = ['auto', 'wireguard-service', 'openvpn-gui', 'rasdial', 'nmcli'];
const WINDOWS_ORDER = ['rasdial', 'wireguard-service', 'openvpn-gui'];
const WINDOWS_TAILSCALE = 'C:\\Program Files\\Tailscale\\tailscale.exe';

/** Connection profile names are passed as a single argv entry (never a shell), but are still validated strictly. */
function isSafeProfileName(name) {
  return typeof name === 'string' && PROFILE_PATTERN.test(name);
}

function isValidSurfsharkMode(mode) { return SURFSHARK_MODES.includes(mode); }

/** Merges the generalised `surfsharkProfile` with the legacy `surfsharkWireguardProfile` key. */
function resolveSurfsharkSettings(vpnSettings) {
  const source = vpnSettings && typeof vpnSettings === 'object' ? vpnSettings : {};
  const mode = isValidSurfsharkMode(source.surfsharkMode) ? source.surfsharkMode : 'auto';
  const profile = source.surfsharkProfile || source.surfsharkWireguardProfile || undefined;
  return { mode, profile };
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
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell: false }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr || ''); error.stdout = String(stdout || ''); reject(error); } else resolve(String(stdout));
    });
  });
}

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fixed script (no interpolated input): lists the current user's built-in Windows VPN profiles. */
const LIST_VPN_SCRIPT = 'Get-VpnConnection | ForEach-Object { [pscustomobject]@{ Name = [string]$_.Name; Status = [string]$_.ConnectionStatus } } | ConvertTo-Json -Compress';
const WIREGUARD_PREFIX = 'WireGuardTunnel$';
const SC_STATES = { 1: 'stopped', 2: 'starting', 3: 'stopping', 4: 'running' };
const TASKLIST_ARGS = ['/FI', 'IMAGENAME eq openvpn.exe', '/FO', 'CSV', '/NH'];

/** `Get-VpnConnection` JSON (object, array or empty) -> [{ name, connected }]. */
function parseVpnConnections(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  let data;
  try { data = JSON.parse(trimmed); } catch { return []; }
  return (Array.isArray(data) ? data : [data]).filter((entry) => entry && typeof entry.Name === 'string')
    .map((entry) => ({ name: entry.Name, connected: /^connected$/i.test(String(entry.Status || '')) }));
}

/** `sc query <service>` -> 'stopped' | 'starting' | 'stopping' | 'running' | 'unknown'. The numeric code is locale independent. */
function parseScState(text) {
  const match = /STATE\s*:\s*(\d+)/.exec(String(text));
  return (match && SC_STATES[Number(match[1])]) || 'unknown';
}

/** `sc query type= service state= all` -> tunnel names (without the service prefix). */
function parseWireguardTunnels(text) {
  const names = [];
  for (const match of String(text).matchAll(/SERVICE_NAME:\s*WireGuardTunnel\$([^\r\n]+)/gi)) names.push(match[1].trim());
  return names;
}

/** `tasklist /FO CSV /NH` -> true when openvpn.exe is running. */
function hasOpenvpnProcess(text) { return /"openvpn\.exe"/i.test(String(text)); }

/** One-time admin command that lets the interactive user start/stop a tunnel service. */
function serviceGrantCommand(tunnel) {
  const sddl = 'D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPWPLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)';
  return `sc sdset "${WIREGUARD_PREFIX}${tunnel}" "${sddl}"`;
}

/** Error that already carries a user-facing message. */
function userError(message) { return Object.assign(new Error(message), { friendly: true }); }

function processText(error) { return `${error?.stdout || ''} ${error?.stderr || ''} ${error?.message || ''}`; }

function rasdialError(error) {
  if (error?.code === 'ENOENT') return 'rasdial.exe was not found';
  if (error?.killed) return 'Windows VPN timed out';
  const text = processText(error);
  const code = /\b(?:error|FAILED)\s+(\d{3,5})\b/i.exec(text)?.[1] || /\b(6\d\d|8\d\d|13\d{3})\b/.exec(text)?.[1];
  switch (code) {
    case '691': return 'Sign-in rejected: re-save the Surfshark service credentials in Windows Settings > VPN';
    case '623': return 'Windows has no VPN profile with that name (check settings.vpn.surfsharkProfile)';
    case '868': case '619': case '651': case '809': case '800': return 'Surfshark server unreachable: check the internet connection and server address';
    case '13801': case '13806': return 'Surfshark IKEv2 certificate error: see backend/VPN.md';
    default: return 'Windows VPN failed to connect' + (code ? ` (error ${code})` : '');
  }
}

function scError(error, tunnel) {
  if (error?.code === 'ENOENT') return 'sc.exe was not found';
  if (error?.killed) return 'Windows service control timed out';
  const text = processText(error);
  if (/access is denied|FAILED 5\b/i.test(text)) return `Access denied - run once as admin: ${serviceGrantCommand(tunnel)}`;
  if (/\b1060\b/.test(text)) return `WireGuard tunnel "${tunnel}" is not installed (see backend/VPN.md)`;
  return 'WireGuard service control failed';
}

class VpnService {
  /**
   * @param {{
   *   platform?: string,
   *   exec?: (file: string, args: string[], timeout?: number) => Promise<string>,
   *   getProfile?: () => string|undefined,
   *   getSettings?: () => { mode?: string, profile?: string },
   *   exists?: (file: string) => boolean,
   *   env?: NodeJS.ProcessEnv,
   *   sleep?: (ms: number) => Promise<void>
   * }} options
   */
  constructor({ platform = process.platform, exec = run, getProfile = () => undefined, getSettings, exists = fs.existsSync, env = process.env, sleep = sleepFor } = {}) {
    this.platform = platform;
    this.exec = exec;
    this.getSettings = getSettings || (() => resolveSurfsharkSettings({ surfsharkProfile: getProfile() }));
    this.exists = exists;
    this.env = env;
    this.sleep = sleep;
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

  // ---- Surfshark strategies. Each probe returns { mode, name, connected } or { error, miss }. ----

  async probeNmcli(profile) {
    try {
      const connections = parseNmcliConnections(await this.exec('nmcli', ['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show'], 5000));
      const found = findSurfsharkProfile(connections, profile);
      return found.profile ? { mode: 'nmcli', name: found.profile.name, connected: found.profile.active } : { error: found.error, miss: true };
    } catch (error) { return { error: friendlyError(error, 'nmcli'), miss: error?.code === 'ENOENT' }; }
  }

  async probeRasdial(profile) {
    if (profile && !isSafeProfileName(profile)) return { error: 'Configured Surfshark profile name is not valid', miss: false };
    let connections;
    try {
      connections = parseVpnConnections(await this.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LIST_VPN_SCRIPT], 15000));
    } catch (error) { return { error: error?.code === 'ENOENT' ? 'PowerShell was not found' : 'Could not list Windows VPN profiles', miss: true }; }
    const match = profile
      ? connections.find((entry) => entry.name === profile)
      : connections.find((entry) => /surfshark/i.test(entry.name) && isSafeProfileName(entry.name));
    if (!match) {
      return { error: profile ? `Windows has no VPN profile named "${profile}" (see backend/VPN.md)` : 'No Surfshark profile in Windows VPN settings (see backend/VPN.md)', miss: true };
    }
    return { mode: 'rasdial', name: match.name, connected: match.connected };
  }

  async scState(tunnel) {
    return parseScState(await this.exec('sc.exe', ['query', `${WIREGUARD_PREFIX}${tunnel}`], 5000));
  }

  async probeWireguard(profile) {
    if (profile && !isSafeProfileName(profile)) return { error: 'Configured Surfshark profile name is not valid', miss: false };
    let tunnel = profile;
    try {
      if (!tunnel) {
        const names = parseWireguardTunnels(await this.exec('sc.exe', ['query', 'type=', 'service', 'state=', 'all'], 10000));
        tunnel = names.find((name) => /surfshark/i.test(name) && isSafeProfileName(name));
        if (!tunnel) return { error: 'No installed WireGuard tunnel named like Surfshark (see backend/VPN.md)', miss: true };
      }
      const state = await this.scState(tunnel);
      return { mode: 'wireguard-service', name: tunnel, connected: state === 'running' || state === 'starting' };
    } catch (error) {
      return { error: scError(error, tunnel || 'surfshark'), miss: true };
    }
  }

  openvpnGuiPath() {
    const roots = [this.env.ProgramFiles, this.env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean);
    return roots.map((root) => path.win32.join(root, 'OpenVPN', 'bin', 'openvpn-gui.exe')).find((file) => this.exists(file));
  }

  openvpnConfigExists(name) {
    const dirs = [this.env.USERPROFILE && path.win32.join(this.env.USERPROFILE, 'OpenVPN', 'config'), this.env.ProgramFiles && path.win32.join(this.env.ProgramFiles, 'OpenVPN', 'config')].filter(Boolean);
    return dirs.some((dir) => this.exists(path.win32.join(dir, `${name}.ovpn`)) || this.exists(path.win32.join(dir, name, `${name}.ovpn`)));
  }

  async probeOpenvpn(profile) {
    if (!profile) return { error: 'Set settings.vpn.surfsharkProfile to the OpenVPN config name (see backend/VPN.md)', miss: true };
    if (!isSafeProfileName(profile)) return { error: 'Configured Surfshark profile name is not valid', miss: false };
    const gui = this.openvpnGuiPath();
    if (!gui) return { error: 'OpenVPN GUI is not installed (see backend/VPN.md)', miss: true };
    if (!this.openvpnConfigExists(profile)) return { error: `OpenVPN GUI has no config named "${profile}"`, miss: true };
    try {
      const connected = hasOpenvpnProcess(await this.exec('tasklist.exe', TASKLIST_ARGS, 5000));
      return { mode: 'openvpn-gui', name: profile, connected, gui };
    } catch { return { error: 'Could not check whether OpenVPN is running', miss: true }; }
  }

  probeMode(mode, profile) {
    const windowsOnly = (probe) => (this.platform === 'win32' ? probe() : { error: `surfsharkMode "${mode}" is Windows only`, miss: false });
    switch (mode) {
      case 'nmcli': return this.platform === 'win32' ? { error: 'surfsharkMode "nmcli" is Linux only', miss: false } : this.probeNmcli(profile);
      case 'rasdial': return windowsOnly(() => this.probeRasdial(profile));
      case 'wireguard-service': return windowsOnly(() => this.probeWireguard(profile));
      case 'openvpn-gui': return windowsOnly(() => this.probeOpenvpn(profile));
      default: return { error: 'Unknown surfsharkMode', miss: false };
    }
  }

  /** Resolves the active Surfshark strategy: the explicit mode, or the first working one in detection order. */
  async probeSurfshark() {
    const { mode, profile } = this.getSettings();
    if (mode && mode !== 'auto') return this.probeMode(mode, profile);
    if (this.platform !== 'win32') return this.probeNmcli(profile);
    for (const candidate of WINDOWS_ORDER) {
      const result = await this.probeMode(candidate, profile);
      if (result.mode || !result.miss) return result;
    }
    const appInstalled = this.exists(path.win32.join(this.env.ProgramFiles || 'C:\\Program Files', 'Surfshark', 'Surfshark.exe'));
    return {
      error: `${appInstalled ? 'The Surfshark app cannot be scripted. ' : ''}Add a Windows VPN (IKEv2) profile named Surfshark - see backend/VPN.md`,
      miss: true
    };
  }

  async surfsharkStatus() {
    const base = { id: 'surfshark', label: 'Surfshark', busy: this.busy.has('surfshark') };
    const probe = await this.probeSurfshark();
    if (!probe.mode) return { ...base, available: false, connected: false, error: probe.error };
    return { ...base, available: true, connected: probe.connected, detail: probe.name, mode: probe.mode, error: this.errors.get('surfshark') };
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
      this.errors.set(id, error?.friendly ? error.message : friendlyError(error, id === 'tailscale' ? 'tailscale' : 'nmcli'));
    } finally { this.busy.delete(id); }
    return this.list();
  }

  async toggleSurfshark(wanted) {
    const probe = await this.probeSurfshark();
    if (!probe.mode) throw userError(probe.error);
    switch (probe.mode) {
      case 'nmcli':
        await this.exec('nmcli', ['connection', wanted ? 'up' : 'down', 'id', probe.name], 20000);
        return;
      case 'rasdial':
        try { await this.exec('rasdial.exe', wanted ? [probe.name] : [probe.name, '/disconnect'], wanted ? 60000 : 15000); }
        catch (error) {
          // Disconnecting an already-closed profile is not a failure.
          if (!wanted && /\b623\b/.test(processText(error))) return;
          throw userError(rasdialError(error));
        }
        return;
      case 'wireguard-service':
        try { await this.exec('sc.exe', [wanted ? 'start' : 'stop', `${WIREGUARD_PREFIX}${probe.name}`], 15000); }
        catch (error) {
          // 1056 = already running, 1062 = already stopped.
          if (!(wanted ? /\b1056\b/ : /\b1062\b/).test(processText(error))) throw userError(scError(error, probe.name));
        }
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const state = await this.scState(probe.name).catch(() => 'unknown');
          if (state === (wanted ? 'running' : 'stopped')) return;
          await this.sleep(500);
        }
        throw userError(wanted ? 'WireGuard tunnel did not start in time' : 'WireGuard tunnel did not stop in time');
      case 'openvpn-gui':
        try { await this.exec(probe.gui, ['--command', wanted ? 'connect' : 'disconnect', probe.name], 10000); }
        catch { throw userError('OpenVPN GUI could not be controlled'); }
        // Connecting takes a while; the next poll reports the final state if this loop gives up first.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await this.sleep(1000);
          const running = hasOpenvpnProcess(await this.exec('tasklist.exe', TASKLIST_ARGS, 5000).catch(() => ''));
          if (running === wanted) return;
        }
        return;
      default: throw userError('Unknown surfsharkMode');
    }
  }
}

module.exports = {
  VpnService, SURFSHARK_MODES, isSafeProfileName, isValidSurfsharkMode, resolveSurfsharkSettings, parseTailscaleStatus, parseNmcliConnections,
  findSurfsharkProfile, parseVpnConnections, parseScState, parseWireguardTunnels, hasOpenvpnProcess, serviceGrantCommand, friendlyError, run
};
