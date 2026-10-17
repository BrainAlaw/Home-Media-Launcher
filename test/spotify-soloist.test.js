'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MediaService } = require('../backend/spotify/service');

const SOLOIST_KEY = 'SOLOIST-KEY-NEVER-EMIT';
const TRACK = { id: 't1', uri: 'spotify:track:t1', title: 'Song', artists: ['A'], album: 'Album', durationMs: 200000 };
const PLAYBACK = {
  device: { id: 'web-dev', name: 'Living Room PC', type: 'Computer', is_active: true, volume_percent: 40 },
  repeat_state: 'off', shuffle_state: false, is_playing: true, progress_ms: 1000,
  item: { id: 't1', uri: 'spotify:track:t1', type: 'track', name: 'Song', duration_ms: 200000, artists: [{ name: 'A' }], album: { name: 'Album', images: [] } }
};

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
const noContent = () => json(204);
const flush = async () => { for (let i = 0; i < 25; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function fakeSafeStorage() {
  return { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`enc:${value}`), decryptString: (buffer) => buffer.toString().replace(/^enc:/, '') };
}

/** Fake Soloist provider with the manager's provider surface (isConnected, deviceName, onState, onConnectionChange). */
class FakeSoloist {
  constructor() {
    this.connected = false;
    this.name = 'Home Media Launcher';
    this.stateListeners = new Set();
    this.connectionListeners = new Set();
  }
  isConnected() { return this.connected; }
  deviceName() { return this.name; }
  onState(listener) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onConnectionChange(listener) { this.connectionListeners.add(listener); return () => this.connectionListeners.delete(listener); }
  setConnected(value) {
    this.connected = value;
    for (const listener of [...this.connectionListeners]) listener(value);
  }
  push(playback) { for (const listener of [...this.stateListeners]) listener(playback); }
}

/** Fetch stub keyed by "METHOD /me/path" (the `/v1` prefix is stripped). Handlers may be functions receiving the call count. */
function router(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const key = `${init.method || 'GET'} ${parsed.hostname === 'accounts.spotify.com' ? 'TOKEN' : parsed.pathname.replace('/v1', '')}`;
    calls.push({ key, init });
    const handler = routes[key];
    if (!handler) throw new Error(`unrouted ${key}`);
    return typeof handler === 'function' ? handler(calls.filter((call) => call.key === key).length) : handler;
  };
  return { fetch, calls, count: (key) => calls.filter((call) => call.key === key).length };
}

async function signedInService({ routes, soloist, autoPoll = true }) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-soloist-'));
  const storage = fakeSafeStorage();
  fs.writeFileSync(path.join(userData, 'spotify-tokens.json'), JSON.stringify({ version: 1, encrypted: storage.encryptString(JSON.stringify({ accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 3_600_000 })).toString('base64') }));
  const net = router({ 'GET /me': json(200, { display_name: 'Maciej' }), ...routes });
  const service = new MediaService({ clientId: 'cid', userData, fetch: net.fetch, safeStorage: storage, sleep: async () => {}, soloist });
  await service.start({ autoPoll });
  return { service, net };
}

const devicesWith = (soloistActive) => ({
  'GET /me/player/devices': json(200, {
    devices: [
      { id: 'soloist-dev', name: 'home media launcher', type: 'Computer', is_active: soloistActive },
      { id: 'web-dev', name: 'Living Room PC', type: 'Computer', is_active: !soloistActive }
    ]
  })
});

test('Soloist live: state comes from the socket and the Web API player endpoint is never called', async () => {
  const soloist = new FakeSoloist();
  const { service, net } = await signedInService({ soloist, autoPoll: false, routes: { 'GET /me/player': json(200, PLAYBACK) } });
  soloist.setConnected(true);
  service.setActive(true);
  soloist.push({ playing: true, track: TRACK, progressMs: 5000, device: { id: 'soloist-dev', name: 'home media launcher', active: true }, idle: false });
  await flush();
  const state = await service.refresh();
  assert.equal(state.playing, true);
  assert.equal(state.track.title, 'Song');
  assert.equal(state.progressMs, 5000);
  assert.equal(net.count('GET /me/player'), 0);
});

test('Soloist live: no double polling while the media UI is active', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const soloist = new FakeSoloist();
  const { service, net } = await signedInService({ soloist, routes: { 'GET /me/player': json(200, PLAYBACK), ...devicesWith(true) } });
  soloist.setConnected(true);
  service.setActive(true);
  t.mock.timers.tick(0);
  await flush();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(net.count('GET /me/player'), 0, 'no playback polling while the socket is live');
  assert.equal(net.count('GET /me/player/devices'), 1, 'device list read once: Soloist already active, then no more checks');
});

test('device hand-off: transfers playback to the Soloist device once it is listed, and only once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const soloist = new FakeSoloist();
  const { service, net } = await signedInService({ soloist, routes: { ...devicesWith(false), 'PUT /me/player': noContent() } });
  soloist.setConnected(true);
  t.mock.timers.tick(0);
  await flush();
  assert.equal(net.count('PUT /me/player'), 1);
  const transfer = net.calls.find((call) => call.key === 'PUT /me/player');
  assert.deepEqual(JSON.parse(transfer.init.body), { device_ids: ['soloist-dev'], play: false }, 'nothing was playing, so the hand-off stays paused');
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(net.count('PUT /me/player'), 1, 'no repeated transfer after success');
  assert.equal(service.status().auth.status, 'signed-in');
});

test('device hand-off keeps playing when playback was live before the transfer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const soloist = new FakeSoloist();
  const { net } = await signedInService({ soloist, routes: { ...devicesWith(false), 'PUT /me/player': noContent() } });
  soloist.setConnected(true);
  soloist.push({ playing: true, track: TRACK, device: { id: 'web-dev', name: 'Living Room PC', active: true }, idle: false });
  t.mock.timers.tick(0);
  await flush();
  assert.deepEqual(JSON.parse(net.calls.find((call) => call.key === 'PUT /me/player').init.body), { device_ids: ['soloist-dev'], play: true });
});

test('device not listed: keeps checking the device list on a retry interval and never transfers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const soloist = new FakeSoloist();
  const { net } = await signedInService({
    soloist,
    routes: { 'GET /me/player/devices': json(200, { devices: [{ id: 'web-dev', name: 'Living Room PC', type: 'Computer', is_active: true }] }), 'PUT /me/player': noContent() }
  });
  soloist.setConnected(true);
  t.mock.timers.tick(0);
  await flush();
  for (let index = 0; index < 3; index += 1) {
    t.mock.timers.tick(10_000);
    await flush();
  }
  assert.ok(net.count('GET /me/player/devices') >= 4, 'retried while absent');
  assert.equal(net.count('PUT /me/player'), 0);
});

test('transfer failures are capped at six attempts per socket session', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const soloist = new FakeSoloist();
  const { net } = await signedInService({ soloist, routes: { ...devicesWith(false), 'PUT /me/player': json(500, { error: { status: 500, message: 'boom' } }) } });
  soloist.setConnected(true);
  t.mock.timers.tick(0);
  await flush();
  for (let index = 0; index < 8; index += 1) {
    t.mock.timers.tick(10_000);
    await flush();
  }
  assert.equal(net.count('PUT /me/player'), 6);
});

test('socket drop: falls back to Web API polling while the media UI is visible', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const soloist = new FakeSoloist();
  const { service, net } = await signedInService({ soloist, routes: { 'GET /me/player': json(200, PLAYBACK), ...devicesWith(true) } });
  soloist.setConnected(true);
  service.setActive(true);
  t.mock.timers.tick(0);
  await flush();
  assert.equal(net.count('GET /me/player'), 0);
  soloist.setConnected(false);
  t.mock.timers.tick(0);
  await flush();
  assert.equal(net.count('GET /me/player'), 1, 'Web API polling resumed immediately');
  t.mock.timers.tick(1000);
  await flush();
  assert.ok(net.count('GET /me/player') >= 2, 'and keeps polling on its own schedule');
  assert.equal(service.status().playing, true);
});

test('socket down at start: the normal Web API path is used untouched', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const soloist = new FakeSoloist();
  const { service, net } = await signedInService({ soloist, routes: { 'GET /me/player': json(200, PLAYBACK), ...devicesWith(true) } });
  service.setActive(true);
  t.mock.timers.tick(0);
  await flush();
  assert.equal(net.count('GET /me/player'), 1);
  assert.equal(net.count('GET /me/player/devices'), 0, 'no device hand-off without a live socket');
  assert.equal(service.status().playing, true);
});

test('socket state is ignored while signed out', async () => {
  const soloist = new FakeSoloist();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-soloist-out-'));
  const service = new MediaService({ clientId: 'cid', userData, fetch: async () => { throw new Error('no network expected'); }, safeStorage: fakeSafeStorage(), soloist });
  await service.start({ autoPoll: false });
  soloist.setConnected(true);
  soloist.push({ playing: true, track: TRACK, device: { id: 'soloist-dev', name: 'Home Media Launcher', active: true }, idle: false });
  assert.equal(service.status().playing, false);
  assert.equal(service.status().auth.status, 'signed-out');
});

test('the Soloist API key never appears in media payloads', async () => {
  const soloist = new FakeSoloist();
  const emitted = [];
  const { service } = await signedInService({ soloist, autoPoll: false, routes: { 'GET /me/player': json(200, PLAYBACK) } });
  service.emit = (event, payload) => emitted.push([event, payload]);
  soloist.setConnected(true);
  soloist.push({ playing: true, track: TRACK, device: { id: 'soloist-dev', name: 'Home Media Launcher', active: true } });
  assert.equal(emitted.length > 0, true);
  assert.equal(JSON.stringify([service.status(), emitted]).includes(SOLOIST_KEY), false);
});
