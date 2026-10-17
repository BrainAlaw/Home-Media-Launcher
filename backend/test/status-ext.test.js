'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('../network-status');
const vpn = require('../vpn');
const { WeatherService, buildSnapshot, summariseForecast, sanitizeIcon } = require('../weather');

const lan = { eth0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }], lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] };
const wlan = { wlan0: [{ family: 'IPv4', address: '10.0.0.7', internal: false }] };

test('nmcli terse parsing handles escaped colons', () => {
  assert.deepEqual(net.splitTerse('yes:My\\:Net:81'), ['yes', 'My:Net', '81']);
  assert.deepEqual(net.parseNmcliDevices('eth0:ethernet:connected\nwlan0:wifi:disconnected\n'), [
    { device: 'eth0', type: 'ethernet', state: 'connected' }, { device: 'wlan0', type: 'wifi', state: 'disconnected' }]);
  assert.deepEqual(net.parseNmcliWifiList('no:Other:40\nyes:Home\\:5G:77\n'), { ssid: 'Home:5G', signal: 77 });
  assert.equal(net.parseNmcliWifiList('no:Other:40'), null);
});

test('netsh and /proc/net/wireless parsing', () => {
  const text = '    Name                   : Wi-Fi\n    State                  : connected\n    SSID                   : Living Room\n    BSSID                  : aa:bb\n    Signal                 : 87%\n';
  assert.deepEqual(net.parseNetsh(text), { ssid: 'Living Room', signal: 87, device: 'Wi-Fi' });
  assert.equal(net.parseNetsh('    State : disconnected\n'), null);
  const proc = 'Inter-| sta-|   Quality\n face | tus | link level noise\n wlan0: 0000   35.  -60.  -256        0\n';
  assert.deepEqual(net.parseProcWireless(proc), { wlan0: 50 });
});

test('readNetwork prefers ethernet, reads wifi details and degrades without tools', async () => {
  const exec = async (file, args) => {
    assert.equal(file, 'nmcli');
    if (args.includes('wifi')) return 'yes:Home:66\n';
    return 'wlan0:wifi:connected\nlo:loopback:unmanaged\n';
  };
  assert.deepEqual(await net.readNetwork({ platform: 'linux', exec, interfaces: wlan }), { type: 'wifi', connected: true, ssid: 'Home', signal: 66, ip: '10.0.0.7' });
  const both = async () => 'wlan0:wifi:connected\neth0:ethernet:connected\n';
  assert.equal((await net.readNetwork({ platform: 'linux', exec: both, interfaces: { ...wlan, ...lan } })).type, 'ethernet');
  const offline = async () => 'eth0:ethernet:unavailable\n';
  assert.deepEqual(await net.readNetwork({ platform: 'linux', exec: offline, interfaces: lan }), { type: 'none', connected: false });
  const missing = async () => { throw Object.assign(new Error('spawn nmcli ENOENT'), { code: 'ENOENT' }); };
  const files = { '/sys/class/net/eth0/operstate': 'up\n', '/sys/class/net/lo/operstate': 'unknown\n' };
  const readFile = async (file) => { if (file in files) return files[file]; throw new Error('ENOENT'); };
  assert.deepEqual(await net.readNetwork({ platform: 'linux', exec: missing, interfaces: lan, readFile }), { type: 'ethernet', connected: true, ip: '192.168.1.20' });
});

test('readNetwork on Windows uses netsh first and the interface table second', async () => {
  const exec = async () => 'State : connected\nSSID : Cafe\nSignal : 40%\nName : Wi-Fi\n';
  assert.equal((await net.readNetwork({ platform: 'win32', exec, interfaces: { 'Wi-Fi': wlan.wlan0 } })).ssid, 'Cafe');
  const fail = async () => { throw new Error('wlansvc is not running'); };
  assert.deepEqual(await net.readNetwork({ platform: 'win32', exec: fail, interfaces: { Ethernet: lan.eth0, 'vEthernet (WSL)': wlan.wlan0 } }), { type: 'ethernet', connected: true, ip: '192.168.1.20' });
  assert.deepEqual(await net.readNetwork({ platform: 'win32', exec: fail, interfaces: {} }), { type: 'none', connected: false });
});

test('tailscale status parsing', () => {
  const running = JSON.stringify({ BackendState: 'Running', Self: { HostName: 'htpc', TailscaleIPs: ['100.64.0.2', 'fd7a::1'] } });
  assert.deepEqual(vpn.parseTailscaleStatus(running), { state: 'Running', connected: true, detail: 'htpc · 100.64.0.2', error: undefined });
  assert.equal(vpn.parseTailscaleStatus('{"BackendState":"Stopped"}').connected, false);
  assert.match(vpn.parseTailscaleStatus('{"BackendState":"NeedsLogin"}').error, /Sign in/);
  assert.equal(vpn.parseTailscaleStatus('garbage').state, 'Unknown');
});

test('profile validation and surfshark auto-detection', () => {
  assert.ok(vpn.isSafeProfileName('Surfshark-UK London'));
  for (const bad of ['', '-rf', 'a;b', 'a$(x)', 'a\nb', 'x'.repeat(65), 42]) assert.equal(vpn.isSafeProfileName(bad), false);
  const connections = vpn.parseNmcliConnections('Wired:802-3-ethernet:eth0\nsurfshark-pl:wireguard:\nwork:wireguard:wg0\n');
  assert.equal(vpn.findSurfsharkProfile(connections).profile.name, 'surfshark-pl');
  assert.equal(vpn.findSurfsharkProfile(connections, 'work').profile.active, true);
  assert.match(vpn.findSurfsharkProfile(connections, 'nope').error, /no connection/);
  assert.match(vpn.findSurfsharkProfile(connections, '-bad').error, /not valid/);
  assert.match(vpn.findSurfsharkProfile(vpn.parseNmcliConnections('Wired:ethernet:eth0')).error, /No Surfshark/);
});

test('VpnService toggles without a shell and reports friendly errors', async () => {
  const calls = [];
  let tailscaleUp = false;
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'tailscale') {
      if (args[0] === 'status') return JSON.stringify({ BackendState: tailscaleUp ? 'Running' : 'Stopped' });
      tailscaleUp = args[0] === 'up';
      return '';
    }
    if (args[0] === '-t') return 'surfshark-uk:wireguard:\n';
    throw Object.assign(new Error('failed'), { stderr: 'Error: Connection activation failed: Not authorized to control networking.' });
  };
  const service = new vpn.VpnService({ platform: 'linux', exec });
  assert.deepEqual((await service.list()).map((entry) => [entry.id, entry.available, entry.connected]), [['tailscale', true, false], ['surfshark', true, false]]);
  const afterUp = await service.toggle('tailscale', true);
  assert.equal(afterUp[0].connected, true);
  const afterShark = await service.toggle('surfshark', true);
  assert.match(afterShark[1].error, /Permission denied/);
  assert.deepEqual(calls.find((call) => call[1] === 'connection'), ['nmcli', 'connection', 'up', 'id', 'surfshark-uk']);
  await assert.rejects(service.toggle('evil; rm', true), /Unknown VPN/);
});

test('VpnService handles missing binaries and Windows', async () => {
  const missing = async () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); };
  const list = await new vpn.VpnService({ platform: 'linux', exec: missing }).list();
  assert.ok(list.every((entry) => !entry.available && /not installed/.test(entry.error)));
  const windows = await new vpn.VpnService({ platform: 'win32', exec: missing }).list();
  assert.match(windows[1].error, /not supported on Windows/);
});

const owmCurrent = { name: 'London', timezone: 0, main: { temp: 11.6, feels_like: 10.2 }, weather: [{ description: 'light rain', icon: '10n' }] };
const owmForecast = {
  city: { timezone: 0 },
  list: [
    { dt: Date.UTC(2026, 9, 17, 12) / 1000, main: { temp: 12, temp_min: 9, temp_max: 13 }, weather: [{ icon: '04d' }] },
    { dt: Date.UTC(2026, 9, 17, 21) / 1000, main: { temp: 8, temp_min: 7, temp_max: 8 }, weather: [{ icon: '01n' }] },
    { dt: Date.UTC(2026, 9, 18, 12) / 1000, main: { temp: 15, temp_min: 11, temp_max: 16 }, weather: [{ icon: '01d' }] }
  ]
};

test('weather snapshot mapping', () => {
  const snapshot = buildSnapshot({ name: 'London' }, owmCurrent, owmForecast, 5);
  assert.deepEqual(snapshot, {
    location: 'London', temperature: 12, feelsLike: 10, condition: 'Light rain', icon: '10n', fetchedAt: 5,
    forecast: [{ day: 'Sat', min: 7, max: 13, icon: '04d' }, { day: 'Sun', min: 11, max: 16, icon: '01d' }]
  });
  assert.equal(sanitizeIcon('../../x'), '03d');
  assert.deepEqual(summariseForecast(null), []);
});

test('WeatherService caches on disk, serves stale data offline and never leaks the key', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weather-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let offline = false;
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (offline) throw new Error(`connect failed for ${url}`);
    const body = url.pathname.includes('geo') ? [{ name: 'London', lat: 51.5, lon: -0.1 }] : url.pathname.endsWith('/weather') ? owmCurrent : owmForecast;
    return { ok: true, status: 200, json: async () => body };
  };
  let clock = 1000;
  const service = new WeatherService({ userData: directory, apiKey: 'SECRET', fetchImpl, now: () => clock });
  const first = await service.get('London');
  assert.equal(first.temperature, 12);
  assert.equal(urls.length, 3);
  assert.ok(urls.every((url) => url.includes('appid=SECRET')));
  await service.get(' london ');
  assert.equal(urls.length, 3);
  clock += 11 * 60 * 1000;
  offline = true;
  assert.equal((await service.get('London')).location, 'London');
  await assert.rejects(service.get('Paris'), (error) => !/SECRET/.test(error.message) && /unreachable/.test(error.message));
  const keyless = new WeatherService({ userData: directory, apiKey: '', fetchImpl });
  assert.equal(keyless.available, false);
  await assert.rejects(keyless.get('London'), /not configured/);
});

test('renderer status formatting helpers', () => {
  const format = require('../../src/renderer/status-format');
  assert.deepEqual([0, 10, 30, 60, 90, undefined].map(format.signalLevel), [0, 1, 2, 3, 4, 0]);
  assert.equal(format.networkLabel({ type: 'wifi', connected: true, ssid: 'Home' }), 'Wi-Fi: Home');
  assert.equal(format.networkLabel({ type: 'none', connected: false }), 'Offline');
  assert.equal(format.networkDetail({ type: 'wifi', connected: true, signal: 80, ip: '10.0.0.2' }), '80% signal · 10.0.0.2');
  assert.equal(format.wmoToIcon(61, false), '10n');
  assert.equal(format.wmoToIcon(0), '01d');
  assert.equal(format.wmoCondition(95), 'Thunderstorm');
  assert.equal(format.vpnSummary([{ available: true, connected: true, busy: false, label: 'Tailscale' }]).state, 'on');
  assert.equal(format.vpnSummary([{ available: false, connected: false, busy: false, label: 'X' }]).state, 'unavailable');
  const icons = require('../../src/renderer/weather-icons');
  assert.ok(icons.markupFor('10d').includes('<path'));
  assert.equal(icons.markupFor('zzz'), icons.markupFor('03d'));
});

test('config accepts only safe Surfshark profile names', () => {
  const { validateConfig } = require('../../src/main/config');
  assert.doesNotThrow(() => validateConfig({ settings: { vpn: { surfsharkWireguardProfile: 'surfshark-uk' } }, rows: [] }));
  assert.throws(() => validateConfig({ settings: { vpn: { surfsharkWireguardProfile: '--evil' } }, rows: [] }), /valid connection name/);
});
