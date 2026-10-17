'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vpn = require('../vpn');
const { validateConfig } = require('../../src/main/config');

const noSleep = async () => {};
const tailscaleStopped = JSON.stringify({ BackendState: 'Stopped' });

/** Builds a mocked exec that records calls and answers per-binary handlers. */
function makeExec(handlers) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    const handler = handlers[file];
    if (!handler) throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' });
    return handler(args);
  };
  return { exec, calls };
}

test('parsers for Windows tooling', () => {
  assert.deepEqual(vpn.parseVpnConnections(''), []);
  assert.deepEqual(vpn.parseVpnConnections('{"Name":"Surfshark UK","Status":"Connected"}'), [{ name: 'Surfshark UK', connected: true }]);
  assert.deepEqual(vpn.parseVpnConnections('[{"Name":"a","Status":"Disconnected"},{"Name":"b","Status":"Connected"}]').map((e) => e.connected), [false, true]);
  assert.deepEqual(vpn.parseVpnConnections('garbage'), []);
  assert.equal(vpn.parseScState('        STATE              : 4  RUNNING'), 'running');
  assert.equal(vpn.parseScState('STATE : 1  STOPPED'), 'stopped');
  assert.equal(vpn.parseScState('nothing'), 'unknown');
  assert.deepEqual(vpn.parseWireguardTunnels('SERVICE_NAME: WireGuardTunnel$surfshark-uk\r\nDISPLAY_NAME: x\r\nSERVICE_NAME: Spooler\r\n'), ['surfshark-uk']);
  assert.equal(vpn.hasOpenvpnProcess('"openvpn.exe","1234","Console","1","8,000 K"'), true);
  assert.equal(vpn.hasOpenvpnProcess('INFO: No tasks are running'), false);
  assert.match(vpn.serviceGrantCommand('surfshark-uk'), /^sc sdset "WireGuardTunnel\$surfshark-uk" "D:/);
});

test('settings resolution keeps the legacy key and validates modes', () => {
  assert.deepEqual(vpn.resolveSurfsharkSettings({ surfsharkWireguardProfile: 'old' }), { mode: 'auto', profile: 'old' });
  assert.deepEqual(vpn.resolveSurfsharkSettings({ surfsharkMode: 'rasdial', surfsharkProfile: 'new', surfsharkWireguardProfile: 'old' }), { mode: 'rasdial', profile: 'new' });
  assert.equal(vpn.resolveSurfsharkSettings({ surfsharkMode: 'bogus' }).mode, 'auto');
  assert.doesNotThrow(() => validateConfig({ settings: { vpn: { surfsharkMode: 'wireguard-service', surfsharkProfile: 'Surfshark UK' } }, rows: [] }));
  assert.throws(() => validateConfig({ settings: { vpn: { surfsharkMode: 'sudo' } }, rows: [] }), /surfsharkMode/);
  assert.throws(() => validateConfig({ settings: { vpn: { surfsharkProfile: '--x' } }, rows: [] }), /surfsharkProfile/);
});

test('Windows rasdial strategy: status and toggle via argv arrays', async () => {
  let connected = false;
  const { exec, calls } = makeExec({
    'tailscale.exe': () => tailscaleStopped,
    'powershell.exe': () => JSON.stringify([{ Name: 'Home VPN', Status: 'Disconnected' }, { Name: 'Surfshark UK', Status: connected ? 'Connected' : 'Disconnected' }]),
    'rasdial.exe': (args) => { connected = args[1] !== '/disconnect'; return 'Command completed successfully.'; }
  });
  const service = new vpn.VpnService({ platform: 'win32', exec, exists: () => false, sleep: noSleep });
  let shark = (await service.list())[1];
  assert.deepEqual([shark.available, shark.connected, shark.detail, shark.mode], [true, false, 'Surfshark UK', 'rasdial']);
  shark = (await service.toggle('surfshark', true))[1];
  assert.equal(shark.connected, true);
  assert.deepEqual(calls.find((call) => call[0] === 'rasdial.exe'), ['rasdial.exe', 'Surfshark UK']);
  shark = (await service.toggle('surfshark', false))[1];
  assert.equal(shark.connected, false);
  assert.deepEqual(calls.filter((call) => call[0] === 'rasdial.exe').pop(), ['rasdial.exe', 'Surfshark UK', '/disconnect']);
});

test('Windows rasdial maps error 691 to a credentials hint', async () => {
  const { exec } = makeExec({
    'tailscale.exe': () => tailscaleStopped,
    'powershell.exe': () => JSON.stringify({ Name: 'Surfshark', Status: 'Disconnected' }),
    'rasdial.exe': () => { throw Object.assign(new Error('failed'), { stdout: 'Remote Access error 691 - access denied because username and password is invalid' }); }
  });
  const shark = (await new vpn.VpnService({ platform: 'win32', exec, exists: () => false }).toggle('surfshark', true))[1];
  assert.match(shark.error, /Sign-in rejected/);
});

test('Windows WireGuard service strategy: discovery, start and access-denied hint', async () => {
  let state = 1;
  let denied = false;
  const { exec, calls } = makeExec({
    'tailscale.exe': () => tailscaleStopped,
    'powershell.exe': () => '',
    'sc.exe': (args) => {
      if (args[0] === 'query' && args[1] === 'type=') return 'SERVICE_NAME: WireGuardTunnel$surfshark-pl\r\n';
      if (args[0] === 'query') return `STATE : ${state}`;
      if (denied) throw Object.assign(new Error('failed'), { stdout: '[SC] StartService FAILED 5:\r\n\r\nAccess is denied.' });
      state = args[0] === 'start' ? 4 : 1;
      return '';
    }
  });
  const service = new vpn.VpnService({ platform: 'win32', exec, exists: () => false, sleep: noSleep });
  let shark = (await service.list())[1];
  assert.deepEqual([shark.available, shark.connected, shark.detail, shark.mode], [true, false, 'surfshark-pl', 'wireguard-service']);
  shark = (await service.toggle('surfshark', true))[1];
  assert.equal(shark.connected, true);
  assert.deepEqual(calls.find((call) => call[1] === 'start'), ['sc.exe', 'start', 'WireGuardTunnel$surfshark-pl']);
  await service.toggle('surfshark', false);
  denied = true;
  shark = (await service.toggle('surfshark', true))[1];
  assert.match(shark.error, /^Access denied - run once as admin: sc sdset "WireGuardTunnel\$surfshark-pl"/);
});

test('Windows OpenVPN GUI strategy uses the documented --command flag', async () => {
  let running = false;
  const gui = 'C:\\Program Files\\OpenVPN\\bin\\openvpn-gui.exe';
  const { exec, calls } = makeExec({
    'tailscale.exe': () => tailscaleStopped,
    'tasklist.exe': () => (running ? '"openvpn.exe","1","Console","1","1 K"' : 'INFO: No tasks are running'),
    [gui]: (args) => { running = args[1] === 'connect'; return ''; }
  });
  const exists = (file) => file === gui || /surfshark-fr\.ovpn$/.test(file);
  const env = { ProgramFiles: 'C:\\Program Files', USERPROFILE: 'C:\\Users\\me' };
  const service = new vpn.VpnService({
    platform: 'win32', exec, exists, env, sleep: noSleep, getSettings: () => ({ mode: 'openvpn-gui', profile: 'surfshark-fr' })
  });
  assert.equal((await service.list())[1].connected, false);
  const shark = (await service.toggle('surfshark', true))[1];
  assert.equal(shark.connected, true);
  assert.deepEqual(calls.find((call) => call[0] === gui), [gui, '--command', 'connect', 'surfshark-fr']);
  const missing = new vpn.VpnService({ platform: 'win32', exec, exists: () => false, env, getSettings: () => ({ mode: 'openvpn-gui', profile: 'x' }) });
  assert.match((await missing.list())[1].error, /not installed/);
});

test('explicit mode on the wrong platform and honest unavailable state', async () => {
  const { exec } = makeExec({ 'tailscale.exe': () => tailscaleStopped, 'powershell.exe': () => '' });
  const linuxMode = new vpn.VpnService({ platform: 'linux', exec, getSettings: () => ({ mode: 'rasdial' }) });
  assert.match((await linuxMode.list())[1].error, /Windows only/);
  const app = new vpn.VpnService({ platform: 'win32', exec, exists: (file) => /Surfshark\.exe$/.test(file), env: { ProgramFiles: 'C:\\Program Files' } });
  const shark = (await app.list())[1];
  assert.equal(shark.available, false);
  assert.match(shark.error, /cannot be scripted/);
  assert.equal((await app.toggle('surfshark', true))[1].available, false);
});
