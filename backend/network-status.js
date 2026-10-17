'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');

/** @typedef {{ type: 'ethernet'|'wifi'|'none'|'unknown', connected: boolean, ssid?: string, signal?: number, ip?: string }} NetworkStatus */

const NONE = Object.freeze({ type: 'none', connected: false });

/** Splits one `nmcli -t` line on unescaped colons and unescapes `\:` and `\\`. */
function splitTerse(line) {
  const fields = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '\\' && index + 1 < line.length) { current += line[index + 1]; index += 1; }
    else if (char === ':') { fields.push(current); current = ''; }
    else current += char;
  }
  fields.push(current);
  return fields;
}

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

/** `nmcli -t -f DEVICE,TYPE,STATE device` -> [{ device, type, state }] */
function parseNmcliDevices(text) {
  return String(text).split(/\r?\n/).filter(Boolean).map(splitTerse)
    .filter((fields) => fields.length >= 3)
    .map(([device, type, state]) => ({ device, type, state }));
}

/** `nmcli -t -f ACTIVE,SSID,SIGNAL device wifi list` -> the active access point, if any. */
function parseNmcliWifiList(text) {
  for (const line of String(text).split(/\r?\n/).filter(Boolean)) {
    const [active, ssid, signal] = splitTerse(line);
    if (active === 'yes') return { ssid: ssid || undefined, signal: clampPercent(signal) };
  }
  return null;
}

/** `netsh wlan show interfaces` -> connected network or null. Keys are matched in English. */
function parseNetsh(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*?)\s*$/.exec(line);
    if (match && !(match[1].toLowerCase() in values)) values[match[1].toLowerCase()] = match[2];
  }
  if (!/^connected$/i.test(values.state || '')) return null;
  const signal = /^(\d+)%$/.exec(values.signal || '');
  return { ssid: values.ssid || undefined, signal: signal ? clampPercent(signal[1]) : undefined, device: values.name };
}

/** `/proc/net/wireless` -> { [iface]: percent } using the link quality column (max 70). */
function parseProcWireless(text) {
  const result = {};
  for (const line of String(text).split(/\r?\n/).slice(2)) {
    const match = /^\s*([^:\s]+):\s+\S+\s+(-?[\d.]+)/.exec(line);
    if (match) result[match[1]] = clampPercent((Number(match[2]) / 70) * 100);
  }
  return result;
}

/** First non-internal IPv4 address of `name` (or of any interface when `name` is omitted). */
function pickIp(interfaces, name) {
  const names = name ? [name] : Object.keys(interfaces);
  for (const key of names) {
    const entry = (interfaces[key] || []).find((address) => (address.family === 'IPv4' || address.family === 4) && !address.internal);
    if (entry) return entry.address;
  }
  return undefined;
}

const VIRTUAL_NAME = /^(lo|docker|veth|br-|virbr|vmnet|vboxnet|tailscale|wg|tun|tap|zt|utun|vEthernet|Loopback)/i;

/** Last-resort detection from the OS interface table: Windows without Wi-Fi, or Linux without NetworkManager. */
function fromInterfaces(interfaces, wirelessNames = new Set(), signals = {}) {
  for (const name of Object.keys(interfaces)) {
    if (VIRTUAL_NAME.test(name)) continue;
    const ip = pickIp(interfaces, name);
    if (!ip) continue;
    const wireless = wirelessNames.has(name) || /^(wi-?fi|wlan|wlp|wlx|wireless)/i.test(name);
    return wireless ? { type: 'wifi', connected: true, ip, signal: signals[name] } : { type: 'ethernet', connected: true, ip };
  }
  return { ...NONE };
}

function stripUndefined(status) {
  return Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined));
}

function run(file, args, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024, shell: false }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });
}

const IGNORED_DEVICE_TYPES = new Set(['loopback', 'tun', 'wireguard', 'bridge', 'generic']);

async function readLinux({ exec, interfaces, readFile }) {
  try {
    const devices = parseNmcliDevices(await exec('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'device']));
    const connected = devices.filter((entry) => entry.state === 'connected' && !IGNORED_DEVICE_TYPES.has(entry.type) && !VIRTUAL_NAME.test(entry.device));
    const ethernet = connected.find((entry) => entry.type === 'ethernet');
    if (ethernet) return stripUndefined({ type: 'ethernet', connected: true, ip: pickIp(interfaces, ethernet.device) });
    const wifi = connected.find((entry) => entry.type === 'wifi');
    if (wifi) {
      let access = null;
      try { access = parseNmcliWifiList(await exec('nmcli', ['-t', '-f', 'ACTIVE,SSID,SIGNAL', 'device', 'wifi', 'list', 'ifname', wifi.device])); } catch { /* signal is optional */ }
      return stripUndefined({ type: 'wifi', connected: true, ssid: access?.ssid, signal: access?.signal, ip: pickIp(interfaces, wifi.device) });
    }
    if (devices.length) return { ...NONE };
  } catch { /* nmcli missing or NetworkManager not running: fall through to /sys */ }
  let signals = {};
  try { signals = parseProcWireless(await readFile('/proc/net/wireless')); } catch { /* no wireless hardware */ }
  const up = new Set();
  try {
    for (const name of Object.keys(interfaces)) {
      const state = (await readFile(`/sys/class/net/${name}/operstate`)).trim();
      if (state === 'up' || state === 'unknown') up.add(name);
    }
  } catch { /* sysfs unavailable */ }
  const filtered = Object.fromEntries(Object.entries(interfaces).filter(([name]) => up.size === 0 || up.has(name)));
  return stripUndefined(fromInterfaces(filtered, new Set(Object.keys(signals)), signals));
}

async function readWindows({ exec, interfaces }) {
  try {
    const wifi = parseNetsh(await exec('netsh', ['wlan', 'show', 'interfaces']));
    if (wifi) return stripUndefined({ type: 'wifi', connected: true, ssid: wifi.ssid, signal: wifi.signal, ip: pickIp(interfaces, wifi.device) || pickIp(interfaces) });
  } catch { /* no WLAN service (desktop PC): use the interface table */ }
  return stripUndefined(fromInterfaces(interfaces));
}

/** Reads the current network state without a shell. Every probe is optional; the result is always a valid NetworkStatus. */
async function readNetwork({ platform = process.platform, exec = run, interfaces = os.networkInterfaces(), readFile = (file) => fs.readFile(file, 'utf8') } = {}) {
  try {
    if (platform === 'win32') return await readWindows({ exec, interfaces });
    if (platform === 'linux') return await readLinux({ exec, interfaces, readFile });
    return stripUndefined(fromInterfaces(interfaces));
  } catch { return { type: 'unknown', connected: false }; }
}

module.exports = { splitTerse, parseNmcliDevices, parseNmcliWifiList, parseNetsh, parseProcWireless, pickIp, fromInterfaces, readNetwork, run };
