'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { SoloistManager, mapSoloistPlayback } = require('../backend/soloist/manager');
const { validateSoloistSettings, normaliseSoloistSettings, DEFAULT_DEVICE_NAME } = require('../backend/soloist/settings');
const { validateConfig } = require('../src/main/config');
const { readSecrets, scrubSecrets } = require('../backend/env');
const { soloistRowView, soloistMediaLine, shortenMessage } = require('../src/renderer/soloist-status');

const KEY = 'SOLOIST-KEY-SECRET-123';
const ABSOLUTE = process.platform === 'win32' ? 'C:\\soloist\\soloist.exe' : '/usr/bin/soloist';

/* ---------------------------------------------------------------- fakes */

class FakeProcess extends EventEmitter {
  constructor({ found = true, startError = null, url = 'ws://127.0.0.1:9/ws' } = {}) {
    super();
    this.found = found;
    this.startError = startError;
    this.url = url;
    this.calls = [];
    this.stopped = false;
  }
  async detect(options) { this.calls.push(['detect', options]); return { found: this.found, path: this.found ? '/opt/soloist' : undefined }; }
  async start(options) { this.calls.push(['start', options]); if (this.startError) throw this.startError; }
  async stop() { this.stopped = true; }
  wsUrl() { return this.url; }
  emitStatus(status) { this.emit('status', status); }
}

class FakeClient extends EventEmitter {
  constructor({ failures = 0 } = {}) {
    super();
    this.failures = failures;
    this.connects = [];
    this.disposed = false;
  }
  async connect(url) {
    this.connects.push(url);
    if (this.failures > 0) { this.failures -= 1; throw new Error('connection refused'); }
  }
  dispose() { this.disposed = true; }
}

function harness({ process: proc = new FakeProcess(), failures = 0, platform = 'linux', reconnectMinMs = 2 } = {}) {
  const clients = [];
  const manager = new SoloistManager({
    platform,
    dataDir: '/data',
    cacheDir: '/cache',
    reconnectMinMs,
    reconnectMaxMs: 8,
    createProcess: () => proc,
    createClient: () => { const client = new FakeClient({ failures }); clients.push(client); return client; }
  });
  const statuses = [];
  const states = [];
  const connections = [];
  manager.on('status', (status) => statuses.push(status));
  manager.on('state', (state) => states.push(state));
  manager.on('connection', (value) => connections.push(value));
  return { manager, proc, clients, statuses, states, connections };
}

const enabled = (extra = {}) => ({ enabled: true, ...extra });
const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/* ---------------------------------------------------------------- settings */

test('settings: defaults are disabled, named device, no binary override', () => {
  assert.deepEqual(normaliseSoloistSettings(undefined), { enabled: false, deviceName: DEFAULT_DEVICE_NAME, binaryPath: '' });
  assert.equal(DEFAULT_DEVICE_NAME, 'Home Media Launcher');
  assert.equal(normaliseSoloistSettings({ enabled: 'yes', deviceName: '   ' }).enabled, false);
  assert.equal(normaliseSoloistSettings({ enabled: true, deviceName: '  Den  ' }).deviceName, 'Den');
});

test('settings: validateConfig accepts a valid block and rejects bad values with named keys', () => {
  const base = { rows: [] };
  assert.doesNotThrow(() => validateConfig({ ...base, settings: { soloist: { enabled: true, deviceName: 'Den', binaryPath: ABSOLUTE } } }));
  assert.doesNotThrow(() => validateConfig({ ...base, settings: {} }));
  assert.doesNotThrow(() => validateConfig({ ...base, settings: { soloist: { binaryPath: '' } } }));
  const cases = [
    ['on', /settings\.soloist must be an object/],
    [{ enabled: 1 }, /settings\.soloist\.enabled must be boolean/],
    [{ deviceName: '' }, /settings\.soloist\.deviceName/],
    [{ deviceName: 'x'.repeat(65) }, /settings\.soloist\.deviceName/],
    [{ deviceName: 'bad\nname' }, /settings\.soloist\.deviceName/],
    [{ binaryPath: 'relative/soloist' }, /settings\.soloist\.binaryPath must be an absolute path/],
    [{ binaryPath: 42 }, /settings\.soloist\.binaryPath must be a string/]
  ];
  for (const [soloist, pattern] of cases) {
    assert.throws(() => validateConfig({ ...base, settings: { soloist } }), pattern);
  }
  assert.throws(() => validateSoloistSettings(null), /must be an object/);
});

test('secrets: SPOTIFY_SOLOIST_API is read into readSecrets and scrubbed from the environment', () => {
  const env = { SPOTIFY_SOLOIST_API: `  ${KEY}  `, SPOTIFY_CLIENT_ID: 'cid' };
  assert.equal(readSecrets(env).soloistApiKey, KEY);
  assert.equal(readSecrets({}).soloistApiKey, '');
  scrubSecrets(env);
  assert.equal('SPOTIFY_SOLOIST_API' in env, false);
});

/* ---------------------------------------------------------------- mapping */

test('mapSoloistPlayback keeps known fields, drops malformed ones and clamps numbers', () => {
  assert.equal(mapSoloistPlayback('nope'), null);
  const mapped = mapSoloistPlayback({
    playing: true,
    progressMs: -5,
    volume: 140,
    repeat: 'everything',
    shuffle: 'yes',
    device: { id: 'd1', name: 'Den', active: true },
    track: { id: 't', uri: 'spotify:track:t', title: 'Song', artists: ['A', 3], album: 'Al', artUrl: 'javascript:alert(1)', durationMs: 1000 }
  });
  assert.equal(mapped.playing, true);
  assert.equal(mapped.progressMs, 0);
  assert.equal(mapped.volume, 100);
  assert.equal(mapped.repeat, undefined);
  assert.equal(mapped.shuffle, undefined);
  assert.equal(mapped.idle, false);
  assert.deepEqual(mapped.track.artists, ['A']);
  assert.equal(mapped.track.artUrl, undefined, 'only https art is accepted');
  assert.deepEqual(mapSoloistPlayback({ playing: false, device: { id: 'd1', active: false } }).idle, true);
});

/* ---------------------------------------------------------------- lifecycle */

test('unsupported on win32 and darwin: never loads or starts the process', async () => {
  for (const platform of ['win32', 'darwin']) {
    const { manager, proc, statuses } = harness({ platform });
    manager.configure({ settings: enabled(), apiKey: KEY });
    assert.equal(manager.status().state, 'unsupported');
    assert.deepEqual(await manager.start(), { ok: false, code: 'UNSUPPORTED', error: 'Soloist is not supported on this platform.' });
    assert.deepEqual(await manager.detect(), { ok: true, supported: false, found: false });
    assert.equal(proc.calls.length, 0);
    assert.equal(statuses.at(-1).state, 'unsupported');
  }
});

test('disabled by default and refuses to start', async () => {
  const { manager, statuses } = harness();
  manager.configure({ settings: undefined, apiKey: KEY });
  assert.equal(manager.status().state, 'disabled');
  assert.equal((await manager.start()).code, 'DISABLED');
  assert.equal(statuses.length, 1);
});

test('missing key reports an error without echoing anything secret', async () => {
  const { manager } = harness();
  manager.configure({ settings: enabled(), apiKey: '' });
  const result = await manager.start();
  assert.equal(result.code, 'NO_KEY');
  assert.equal(manager.status().state, 'error');
  assert.match(manager.status().message, /SPOTIFY_SOLOIST_API is not set/);
});

test('not installed when detect finds no binary', async () => {
  const { manager, proc } = harness({ process: new FakeProcess({ found: false }) });
  manager.configure({ settings: enabled(), apiKey: KEY });
  assert.equal((await manager.start()).code, 'NOT_INSTALLED');
  assert.equal(manager.status().state, 'not-installed');
  assert.equal(proc.calls.some(([name]) => name === 'start'), false);
});

test('happy path: stopped -> starting -> connected, playback mapped from the socket, key passed only to the process', async () => {
  const proc = new FakeProcess();
  const { manager, clients, states, connections, statuses } = harness({ process: proc });
  manager.configure({ settings: enabled({ deviceName: 'Den' }), apiKey: KEY });
  assert.equal((await manager.start()).ok, true);
  assert.equal(manager.status().state, 'connected');
  assert.equal(manager.isConnected(), true);
  assert.equal(manager.deviceName(), 'Den');
  assert.deepEqual(connections, [true]);
  assert.equal(clients[0].connects[0], 'ws://127.0.0.1:9/ws');
  const startOptions = proc.calls.find(([name]) => name === 'start')[1];
  assert.equal(startOptions.deviceName, 'Den');
  assert.equal(startOptions.apiKey, KEY);
  assert.equal(startOptions.dataDir, '/data');
  assert.equal(startOptions.cacheDir, '/cache');

  clients[0].emit('state', { playing: true, track: { id: 't', uri: 'spotify:track:t', title: 'T', artists: [], album: '', durationMs: 5 }, device: { id: 'd', name: 'Den', active: true } });
  assert.equal(states.length, 1);
  assert.equal(states[0].playing, true);

  assert.equal(statuses.at(-1).state, 'connected');
  const seen = JSON.stringify({ statuses, states, connections });
  assert.equal(seen.includes(KEY), false, 'the key never appears in emitted payloads');
});

test('start failure: the key is redacted from the error and from the status', async () => {
  const { manager, statuses } = harness({ process: new FakeProcess({ startError: new Error(`spawn failed with ${KEY} in argv`) }) });
  manager.configure({ settings: enabled(), apiKey: KEY });
  const result = await manager.start();
  assert.equal(result.code, 'START_FAILED');
  assert.equal(manager.status().state, 'error');
  assert.match(result.error, /\[redacted\]/);
  assert.equal(JSON.stringify([result, statuses]).includes(KEY), false);
});

test('socket drop: reports starting and reconnects with backoff', async () => {
  const { manager, clients, connections } = harness({ failures: 1 });
  manager.configure({ settings: enabled(), apiKey: KEY });
  await manager.start();
  assert.equal(manager.status().state, 'starting', 'first connect failed, retry pending');
  await waitFor(() => manager.isConnected());
  assert.equal(clients[0].connects.length, 2);
  clients[0].emit('disconnect');
  assert.equal(manager.status().state, 'starting');
  await waitFor(() => manager.isConnected() && clients[0].connects.length === 3);
  assert.deepEqual(connections, [true, false, true]);
});

test('logged-out Soloist is not reported as connected even with a live socket', async () => {
  const proc = new FakeProcess();
  const { manager } = harness({ process: proc });
  manager.configure({ settings: enabled(), apiKey: KEY });
  await manager.start();
  proc.emitStatus({ state: 'running', loggedIn: false });
  assert.equal(manager.isConnected(), false);
  assert.equal(manager.status().state, 'starting');
});

test('process error and unexpected exit surface as error states with sanitised messages', async () => {
  const proc = new FakeProcess();
  const { manager } = harness({ process: proc });
  manager.configure({ settings: enabled(), apiKey: KEY });
  await manager.start();
  proc.emitStatus({ state: 'error', message: `crash near ${KEY}` });
  assert.equal(manager.status().state, 'error');
  assert.equal(JSON.stringify(manager.status()).includes(KEY), false);

  const second = harness({ process: new FakeProcess() });
  second.manager.configure({ settings: enabled(), apiKey: KEY });
  await second.manager.start();
  second.proc.emitStatus({ state: 'exited' });
  assert.equal(second.manager.status().message, 'Soloist stopped unexpectedly.');
  assert.equal(second.manager.isConnected(), false);
});

test('stop disposes the socket and stops the process; safe to call twice', async () => {
  const proc = new FakeProcess();
  const { manager, clients } = harness({ process: proc });
  manager.configure({ settings: enabled(), apiKey: KEY });
  await manager.start();
  await manager.stop();
  await manager.stop();
  assert.equal(proc.stopped, true);
  assert.equal(clients[0].disposed, true);
  assert.equal(manager.status().state, 'stopped');
  assert.equal(manager.isConnected(), false);
});

test('reconcile: enabling starts, disabling stops, a device-name change restarts', async () => {
  const proc = new FakeProcess();
  const { manager } = harness({ process: proc });
  await manager.reconcile({ settings: undefined, apiKey: KEY });
  assert.equal(manager.status().state, 'disabled');
  await manager.reconcile({ settings: enabled({ deviceName: 'Den' }), apiKey: KEY });
  assert.equal(manager.status().state, 'connected');
  await manager.reconcile({ settings: enabled({ deviceName: 'Den' }), apiKey: KEY });
  assert.equal(proc.calls.filter(([name]) => name === 'start').length, 1, 'no restart when nothing changed');
  await manager.reconcile({ settings: enabled({ deviceName: 'Lounge' }), apiKey: KEY });
  assert.equal(proc.calls.filter(([name]) => name === 'start').length, 2, 'renamed device restarts the process');
  assert.equal(manager.status().deviceName, 'Lounge');
  await manager.reconcile({ settings: { enabled: false }, apiKey: KEY });
  assert.equal(manager.status().state, 'disabled');
  assert.equal(proc.stopped, true);
});

test('status payload contains only the documented fields', async () => {
  const { manager } = harness();
  manager.configure({ settings: enabled({ binaryPath: ABSOLUTE }), apiKey: KEY });
  const status = manager.status();
  assert.deepEqual(Object.keys(status).sort(), ['connected', 'deviceName', 'enabled', 'platform', 'state']);
  assert.equal(JSON.stringify(status).includes(ABSOLUTE), false, 'binary path is not exposed to the renderer');
});

test('a missing Soloist module becomes an error status, not a rejected promise', async () => {
  const manager = new SoloistManager({
    platform: 'linux',
    createProcess: () => { throw new Error(`Cannot find module for ${KEY}`); },
    createClient: () => new FakeClient()
  });
  manager.configure({ settings: enabled(), apiKey: KEY });
  const result = await manager.start();
  assert.equal(result.ok, false);
  assert.equal(manager.status().state, 'error');
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

/* ---------------------------------------------------------------- renderer helpers */

test('quick-settings row explains every state and locks the switch on unsupported platforms', () => {
  assert.deepEqual(soloistRowView({ state: 'unsupported', enabled: true }), { state: 'unavailable', checked: false, disabled: true, subtitle: 'Not available on this PC' });
  assert.equal(soloistRowView({ state: 'disabled', enabled: false }).checked, false);
  assert.equal(soloistRowView({ state: 'connected', enabled: true, deviceName: 'Den' }).subtitle, 'Connected as Den');
  assert.equal(soloistRowView({ state: 'starting', enabled: true }).state, 'busy');
  assert.equal(soloistRowView({ state: 'error', enabled: true, message: 'Boom. More detail follows.' }).subtitle, 'Boom');
  assert.equal(soloistRowView(null).subtitle, 'Off');
  assert.ok(shortenMessage('x'.repeat(200)).length <= 84);
});

test('media widget line shows only while the socket is live on this computer', () => {
  const connected = { state: 'connected', deviceName: 'Home Media Launcher' };
  assert.equal(soloistMediaLine(connected, { name: 'home media launcher' }), 'Soloist: this computer');
  assert.equal(soloistMediaLine(connected, undefined), 'Soloist: this computer');
  assert.equal(soloistMediaLine(connected, { name: 'Phone' }), '');
  assert.equal(soloistMediaLine({ state: 'starting', deviceName: 'x' }, undefined), '');
});

/* ---------------------------------------------------------------- ext namespace */

function extContext(config, { userData = fs.mkdtempSync(path.join(os.tmpdir(), 'soloist-ext-')), key = KEY } = {}) {
  const emitted = [];
  return {
    ctx: { userData, secrets: { soloistApiKey: key }, config: () => config, getWindow: () => null, emit: (event, payload) => emitted.push([event, payload]) },
    emitted
  };
}

async function withPlatform(platform, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try { return await fn(); } finally { Object.defineProperty(process, 'platform', descriptor); }
}

test('ext soloist: win32 reports unsupported through status, start and apply', async () => {
  await withPlatform('win32', async () => {
    delete require.cache[require.resolve('../src/main/ext/soloist')];
    const ext = require('../src/main/ext/soloist');
    const { ctx, emitted } = extContext({ soloist: enabled() });
    ext.start(ctx);
    assert.equal((await ext.handlers.status(ctx)).state, 'unsupported');
    assert.equal((await ext.handlers.start(ctx)).code, 'UNSUPPORTED');
    assert.equal((await ext.handlers.apply(ctx)).state, 'unsupported');
    assert.equal(emitted.every(([event]) => event === 'status'), true);
    assert.equal(JSON.stringify(emitted).includes(KEY), false);
    ext.stop();
  });
});

test('ext soloist: status transitions on linux follow settings and never leak the key', async () => {
  await withPlatform('linux', async () => {
    delete require.cache[require.resolve('../src/main/ext/soloist')];
    const ext = require('../src/main/ext/soloist');
    const settings = { soloist: { enabled: false } };
    const { ctx, emitted } = extContext(settings);
    ext.start(ctx);
    assert.equal((await ext.handlers.status(ctx)).state, 'disabled');
    settings.soloist = { enabled: true };
    const applied = await ext.handlers.apply(ctx);
    // Without the real Soloist binary the process factory fails, so the transition is to an explained error (or not-installed).
    assert.ok(['error', 'not-installed'].includes(applied.state), `unexpected state ${applied.state}`);
    assert.equal(applied.enabled, true);
    settings.soloist = { enabled: false };
    assert.equal((await ext.handlers.apply(ctx)).state, 'disabled');
    assert.equal(JSON.stringify(emitted).includes(KEY), false, 'the key never appears in ext events');
    ext.stop();
  });
});
