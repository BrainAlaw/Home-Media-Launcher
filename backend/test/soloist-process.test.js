'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  SoloistProcess,
  freePort,
  backoffDelay,
  parseWsAddress,
  validateStartOptions,
  MAX_RESTARTS
} = require('../soloist/process');
const { defaultDirectories, resolveBinaryPath } = require('../soloist/paths');
const { readSecrets, scrubSecrets } = require('../env');

const KEY = 'sk-soloist-TEST-key-0123456789';
const DATA_DIR = path.resolve('soloist-test', 'data');
const CACHE_DIR = path.resolve('soloist-test', 'cache');
const WS_PORT_FILE = path.join(DATA_DIR, 'ws.port');
const WS_ADDR_FILE = path.join(DATA_DIR, 'ws.addr');
const START = Object.freeze({ deviceName: 'Living Room', apiKey: KEY, dataDir: DATA_DIR, cacheDir: CACHE_DIR, wsPort: 0 });

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Manual clock: timers run only when `advance()` moves time forward. */
function createClock(start = 1_000_000) {
  let now = start;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, ms) {
      sequence += 1;
      timers.set(sequence, { at: now + ms, callback });
      return sequence;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending: () => timers.size,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => (a[1].at - b[1].at) || (a[0] - b[0]))[0];
        if (!next || next[1].at > target) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
        await flush();
      }
      now = target;
      await flush();
    }
  };
}

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    return true;
  }
}

function createFakeFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  const directories = [];
  return {
    files,
    directories,
    async readFile(file) {
      if (!files.has(file)) {
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(file);
    },
    async rm(file) {
      files.delete(file);
    },
    async mkdir(directory) {
      directories.push(directory);
    }
  };
}

function harness({ platform = 'linux', version = 'soloist 1.4.0', execError = null, clock = createClock(), files = {} } = {}) {
  const fs = createFakeFs(files);
  const children = [];
  const spawnCalls = [];
  const execCalls = [];
  const spawn = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    const child = new FakeChild(1000 + children.length);
    children.push(child);
    return child;
  };
  const execFile = (file, args, options, callback) => {
    execCalls.push({ file, args, options });
    if (execError) callback(execError, '', '');
    else callback(null, `${version}\n`, '');
  };
  const proc = new SoloistProcess({ binaryPath: 'soloist', spawn, execFile, fs, platform, clock, env: {} });
  return { proc, fs, clock, children, spawnCalls, execCalls };
}

function enoent() {
  const error = new Error('spawn soloist ENOENT');
  error.code = 'ENOENT';
  return error;
}

test('detect reports unsupported platforms without executing anything', async () => {
  const { proc, execCalls } = harness({ platform: 'win32' });
  assert.deepEqual(await proc.detect(), { available: false, reason: 'unsupported-platform', path: null, version: null });
  assert.equal(execCalls.length, 0);
  assert.equal(proc.status().state, 'unsupported');
});

test('detect runs soloist --version without a shell and with a 5 s timeout', async () => {
  const { proc, execCalls } = harness();
  assert.deepEqual(await proc.detect(), { available: true, reason: 'ok', path: 'soloist', version: 'soloist 1.4.0' });
  assert.deepEqual(execCalls[0].args, ['--version']);
  assert.equal(execCalls[0].options.shell, false);
  assert.equal(execCalls[0].options.timeout, 5000);
});

test('detect treats a missing binary and a timed-out probe as not-installed', async () => {
  const missing = harness({ execError: enoent() });
  assert.equal((await missing.proc.detect()).reason, 'not-installed');
  assert.equal(missing.proc.status().state, 'not-installed');

  const timedOut = harness({ execError: Object.assign(new Error('killed'), { killed: true, code: null }) });
  const result = await timedOut.proc.detect();
  assert.equal(result.reason, 'not-installed');
  assert.equal(result.detail, 'timed out');
});

test('start refuses unsupported platforms and missing binaries without spawning', async () => {
  const unsupported = harness({ platform: 'darwin' });
  assert.equal((await unsupported.proc.start(START)).state, 'unsupported');
  assert.equal(unsupported.spawnCalls.length, 0);
  assert.equal(unsupported.execCalls.length, 0);

  const missing = harness({ execError: enoent() });
  assert.equal((await missing.proc.start(START)).state, 'not-installed');
  assert.equal(missing.spawnCalls.length, 0);
});

test('start spawns argv without a shell, passes no secret through env and does not respawn while active', async () => {
  const { proc, spawnCalls } = harness();
  const status = await proc.start({ ...START, wsPort: 9000, pipewireDevice: 'alsa_output.pci' });
  assert.equal(status.state, 'starting');
  assert.equal(status.device, 'Living Room');
  assert.equal(spawnCalls.length, 1);
  const [call] = spawnCalls;
  assert.equal(call.command, 'soloist');
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.options.env, {});
  assert.deepEqual(call.args, [
    '--device-name', 'Living Room',
    '--api-key', KEY,
    '--data-dir', DATA_DIR,
    '--cache-dir', CACHE_DIR,
    '--ws', '127.0.0.1:9000',
    '--pipewire-device', 'alsa_output.pci'
  ]);
  await proc.start(START);
  assert.equal(spawnCalls.length, 1);
});

test('the API key never appears in status, events or diagnostics', async () => {
  const { proc, children } = harness();
  const logs = [];
  const statuses = [];
  proc.on('log', (entry) => logs.push(entry));
  proc.on('status', (entry) => statuses.push(entry));
  await proc.start(START);
  const [child] = children;
  child.stdout.emit('data', Buffer.from(`connecting with ${KEY}\n`));
  child.stdout.emit('data', Buffer.from(KEY.slice(0, 7)));
  child.stdout.emit('data', Buffer.from(`${KEY.slice(7)} rejected\r\n`));
  child.stderr.emit('data', Buffer.from(`warn: ${KEY}\n`));
  child.emit('exit', 2, null);

  const serialised = JSON.stringify({ status: proc.status(), diagnostics: proc.diagnostics(), logs, statuses });
  assert.equal(serialised.includes(KEY), false);
  assert.ok(proc.diagnostics().lines.includes('connecting with [REDACTED]'));
  assert.ok(proc.diagnostics().lines.includes('[REDACTED] rejected'));
  assert.equal(proc.status().state, 'crashed');
});

test('a key split across the partial-line flush boundary is never recorded whole', async () => {
  const { proc, children } = harness();
  const lines = [];
  proc.on('log', (entry) => lines.push(entry.line));
  await proc.start(START);
  const [child] = children;
  child.stdout.emit('data', Buffer.from('x'.repeat(8200) + KEY.slice(0, 5)));
  child.stdout.emit('data', Buffer.from(`${KEY.slice(5)}\n`));
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    assert.equal(line.includes(KEY), false);
    assert.equal(line.includes(KEY.slice(0, 5)), false);
  }
});

test('diagnostics keeps only the last 50 redacted lines', async () => {
  const { proc, children } = harness();
  await proc.start(START);
  const output = Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n');
  children[0].stdout.emit('data', Buffer.from(`${output}\n`));
  const { lines } = proc.diagnostics();
  assert.equal(lines.length, 50);
  assert.equal(lines[0], 'line 10');
  assert.equal(lines.at(-1), 'line 59');
});

test('exit code 10 is terminal and shows the expiry message without restarting', async () => {
  const { proc, children, spawnCalls, clock } = harness();
  await proc.start(START);
  children[0].emit('exit', 10, null);
  const status = proc.status();
  assert.equal(status.state, 'expired');
  assert.equal(status.message, 'Soloist build expired - download a newer build');
  await clock.advance(120000);
  assert.equal(spawnCalls.length, 1);
});

test('backoff schedule is 2, 4, 8, 16, 32, 60 s and then the process is failed', async () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(backoffDelay), [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  assert.equal(MAX_RESTARTS, 6);

  const { proc, children, spawnCalls, clock } = harness();
  await proc.start(START);
  const delays = [2000, 4000, 8000, 16000, 32000, 60000];
  for (const [index, delay] of delays.entries()) {
    children.at(-1).emit('exit', 1, null);
    assert.equal(proc.status().state, 'crashed');
    assert.match(proc.status().message, new RegExp(`restart ${index + 1}/6 in ${delay / 1000} s`));
    await clock.advance(delay - 1);
    assert.equal(spawnCalls.length, index + 1);
    await clock.advance(1);
    assert.equal(spawnCalls.length, index + 2);
  }
  children.at(-1).emit('exit', 1, null);
  assert.equal(proc.status().state, 'failed');
  await clock.advance(120000);
  assert.equal(spawnCalls.length, 7);
});

test('a run that stays up for 60 s resets the restart counter', async () => {
  const { proc, children, clock } = harness();
  await proc.start(START);
  children[0].emit('exit', 1, null);
  await clock.advance(2000);
  await clock.advance(60000);
  children.at(-1).emit('exit', 1, null);
  assert.match(proc.status().message, /restart 1\/6 in 2 s/);
});

test('stop sends SIGTERM, escalates to SIGKILL after 5 s and resolves on exit', async () => {
  const { proc, children, spawnCalls, clock } = harness();
  await proc.start(START);
  const [child] = children;
  let settled = false;
  const stopping = proc.stop().then((status) => { settled = true; return status; });
  assert.deepEqual(child.signals, ['SIGTERM']);
  await clock.advance(4999);
  assert.deepEqual(child.signals, ['SIGTERM']);
  await clock.advance(1);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  await flush();
  assert.equal(settled, false);
  child.emit('exit', null, 'SIGKILL');
  const status = await stopping;
  assert.equal(status.state, 'stopped');
  await clock.advance(120000);
  assert.equal(spawnCalls.length, 1);
  assert.equal(clock.pending(), 0);
});

test('a clean exit without stop reports stopped and does not restart', async () => {
  const { proc, children, spawnCalls, clock } = harness();
  await proc.start(START);
  children[0].emit('exit', 0, null);
  assert.equal(proc.status().state, 'stopped');
  assert.equal(proc.status().message, 'Soloist exited');
  await clock.advance(120000);
  assert.equal(spawnCalls.length, 1);
});

test('dispose stops the process and blocks later starts', async () => {
  const { proc, children } = harness();
  await proc.start(START);
  const disposing = proc.dispose();
  children[0].emit('exit', null, 'SIGTERM');
  await disposing;
  assert.equal(proc.status().state, 'stopped');
  await assert.rejects(proc.start(START), /disposed/);
});

test('the WebSocket port is read from ws.port and stale files are removed before spawning', async () => {
  const { proc, fs, clock } = harness({ files: { [WS_PORT_FILE]: '1111' } });
  await proc.start(START);
  assert.equal(fs.files.has(WS_PORT_FILE), false);
  await clock.advance(0);
  assert.equal(proc.status().state, 'starting');
  assert.equal(proc.wsUrl(), null);

  fs.files.set(WS_PORT_FILE, '43210\n');
  await clock.advance(250);
  assert.equal(proc.status().state, 'running');
  assert.equal(proc.status().wsPort, 43210);
  assert.equal(proc.wsUrl(), 'ws://127.0.0.1:43210');
});

test('without an endpoint file the process reports running after 10 s with no WebSocket URL', async () => {
  const { proc, clock } = harness();
  await proc.start(START);
  await clock.advance(10000);
  const status = proc.status();
  assert.equal(status.state, 'running');
  assert.equal(status.wsPort, null);
  assert.equal(status.message, 'Soloist is running; WebSocket address was not published');
  assert.equal(proc.wsUrl(), null);
});

test('a fixed WebSocket port is used when no endpoint file is published', async () => {
  const { proc, clock } = harness();
  await proc.start({ ...START, wsPort: 9000 });
  assert.equal(proc.wsUrl(), null);
  await clock.advance(10000);
  assert.equal(proc.status().state, 'running');
  assert.equal(proc.wsUrl(), 'ws://127.0.0.1:9000');
});

test('ws.addr is accepted only for loopback hosts and valid ports', () => {
  assert.equal(parseWsAddress('127.0.0.1:4321\n'), 4321);
  assert.equal(parseWsAddress('10.0.0.5:1234'), null);
  assert.equal(parseWsAddress('localhost:99999'), null);
  assert.equal(parseWsAddress('garbage'), null);
});

test('ws.addr is used when ws.port is absent', async () => {
  const { proc, fs, clock } = harness();
  await proc.start(START);
  fs.files.set(WS_ADDR_FILE, '127.0.0.1:5555');
  await clock.advance(250);
  assert.equal(proc.status().wsPort, 5555);
  assert.equal(proc.status().state, 'running');
});

test('validateStartOptions rejects relative paths and control characters without echoing the key', () => {
  assert.throws(() => validateStartOptions({ ...START, dataDir: 'relative/dir' }), /dataDir must be an absolute path/);
  assert.throws(() => validateStartOptions({ ...START, wsPort: 70000 }), /wsPort/);
  assert.throws(
    () => validateStartOptions({ ...START, apiKey: `${KEY}\nextra` }),
    (error) => error instanceof TypeError && !error.message.includes(KEY)
  );
});

test('freePort asks the OS for a loopback port and returns the bound one', async () => {
  const listens = [];
  const net = {
    createServer() {
      const server = new EventEmitter();
      server.listen = (port, host, callback) => { listens.push({ port, host }); callback(); };
      server.address = () => ({ port: 45678 });
      server.close = (callback) => callback();
      return server;
    }
  };
  assert.equal(await freePort({ net }), 45678);
  assert.deepEqual(listens, [{ port: 0, host: '127.0.0.1' }]);
});

test('defaultDirectories follows Soloist defaults and XDG overrides', () => {
  const home = path.resolve('home-user');
  const defaults = defaultDirectories({ env: {}, homedir: home });
  assert.equal(defaults.dataDir, path.join(home, '.local', 'share', 'soloist'));
  assert.equal(defaults.cacheDir, path.join(home, '.cache', 'soloist'));

  const xdgData = path.resolve('xdg', 'data');
  const overridden = defaultDirectories({ env: { XDG_DATA_HOME: xdgData, XDG_CACHE_HOME: 'relative' }, homedir: home });
  assert.equal(overridden.dataDir, path.join(xdgData, 'soloist'));
  assert.equal(overridden.cacheDir, path.join(home, '.cache', 'soloist'));
  assert.equal(resolveBinaryPath('  /opt/soloist/soloist '), '/opt/soloist/soloist');
  assert.equal(resolveBinaryPath(''), 'soloist');
});

test('readSecrets exposes the Soloist key and scrubSecrets removes it from the environment', () => {
  assert.equal(readSecrets({ SPOTIFY_SOLOIST_API: ' abc ' }).soloistApiKey, 'abc');
  const env = { SPOTIFY_SOLOIST_API: KEY, VP_API: 'x' };
  scrubSecrets(env);
  assert.equal('SPOTIFY_SOLOIST_API' in env, false);
});
