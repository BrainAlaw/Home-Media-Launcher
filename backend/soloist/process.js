'use strict';

const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const nodeFsPromises = require('node:fs/promises');
const nodeNet = require('node:net');
const path = require('node:path');

const EXIT_CODE_EXPIRED = 10;
const MAX_RESTARTS = 6;
const RESTART_BASE_MS = 2000;
const RESTART_CAP_MS = 60000;
const STABLE_RUN_MS = 60000;
const STOP_GRACE_MS = 5000;
const VERSION_TIMEOUT_MS = 5000;
const WS_POLL_MS = 250;
const WS_WAIT_MS = 10000;
const LOG_LINE_LIMIT = 50;
const MAX_PARTIAL_LINE = 8192;
const REDACTION = '[REDACTED]';
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const WS_PORT_FILE = 'ws.port';
const WS_ADDR_FILE = 'ws.addr';

const MESSAGES = Object.freeze({
  unsupported: 'Soloist is available on Linux only (x86_64, aarch64, armv7)',
  notInstalled: 'Soloist is not installed; install it or set soloist.binaryPath',
  stopped: 'Soloist is not running',
  exitedCleanly: 'Soloist exited',
  starting: 'Starting Soloist',
  running: 'Soloist is running',
  wsUnpublished: 'Soloist is running; WebSocket address was not published',
  expired: 'Soloist build expired - download a newer build',
  failed: 'Soloist keeps crashing; restart attempts exhausted - see diagnostics',
  directories: 'Cannot create Soloist data or cache directory'
});

const defaultClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle)
});

/** Exponential restart delay for the 1-based restart `attempt`: 2 s, 4 s, 8 s, 16 s, 32 s, then capped at 60 s. */
function backoffDelay(attempt) {
  return Math.min(RESTART_BASE_MS * 2 ** (attempt - 1), RESTART_CAP_MS);
}

function requireText(value, name, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  const text = value.trim();
  if (text.length > maxLength || CONTROL_CHARACTERS.test(text)) throw new TypeError(`${name} is invalid`);
  return text;
}

function requireAbsolute(value, name) {
  const text = requireText(value, name, 4096);
  if (!path.isAbsolute(text)) throw new TypeError(`${name} must be an absolute path`);
  return text;
}

/** Validates and normalises `start()` options. Error messages never echo the API key. */
function validateStartOptions(options) {
  if (!options || typeof options !== 'object') throw new TypeError('Soloist start options are required');
  const wsPort = options.wsPort === undefined ? 0 : options.wsPort;
  if (!Number.isInteger(wsPort) || wsPort < 0 || wsPort > 65535) throw new TypeError('wsPort must be an integer between 0 and 65535');
  const pipewireDevice = options.pipewireDevice === undefined || options.pipewireDevice === null || options.pipewireDevice === ''
    ? null
    : requireText(options.pipewireDevice, 'pipewireDevice', 256);
  return Object.freeze({
    deviceName: requireText(options.deviceName, 'deviceName', 64),
    apiKey: requireText(options.apiKey, 'apiKey', 512),
    dataDir: requireAbsolute(options.dataDir, 'dataDir'),
    cacheDir: requireAbsolute(options.cacheDir, 'cacheDir'),
    wsPort,
    pipewireDevice
  });
}

/** Builds the argv array for `soloist` (never passed through a shell). */
function buildArgs(config) {
  const args = [
    '--device-name', config.deviceName,
    '--api-key', config.apiKey,
    '--data-dir', config.dataDir,
    '--cache-dir', config.cacheDir,
    '--ws', `127.0.0.1:${config.wsPort}`
  ];
  if (config.pipewireDevice) args.push('--pipewire-device', config.pipewireDevice);
  return args;
}

function toPort(text) {
  const port = Number(text);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** Accepts only loopback `host:port` pairs; anything else is ignored. */
function parseWsAddress(text) {
  const match = /^(.+):(\d{1,5})$/.exec(String(text).trim());
  if (!match || !LOOPBACK_HOSTS.has(match[1])) return null;
  return toPort(match[2]);
}

async function readText(fs, file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}

/** Reads the port Soloist publishes after binding `--ws 127.0.0.1:0`; returns null until a file exists. */
async function readWsPort(fs, dataDir) {
  const portText = await readText(fs, path.join(dataDir, WS_PORT_FILE));
  const port = portText === null ? null : toPort(portText.trim());
  if (port !== null) return port;
  const addrText = await readText(fs, path.join(dataDir, WS_ADDR_FILE));
  return addrText === null ? null : parseWsAddress(addrText);
}

/** Removes stale endpoint files so a previous run's port is never mistaken for the current one. */
async function removeWsFiles(fs, dataDir) {
  for (const name of [WS_PORT_FILE, WS_ADDR_FILE]) {
    try { await fs.rm(path.join(dataDir, name), { force: true }); } catch { /* best effort */ }
  }
}

function parseVersion(stdout) {
  const line = String(stdout ?? '').split(/\r?\n/).map((entry) => entry.trim()).find(Boolean);
  return line ? line.slice(0, 120) : null;
}

function describeExecError(error) {
  if (error.killed) return 'timed out';
  return String(error.code ?? 'error');
}

function describeExit(code, signal, error) {
  if (error) return 'a spawn error';
  if (signal) return `signal ${signal}`;
  return `code ${code}`;
}

/**
 * Supervises a headless Soloist (Spotify Connect) process on Linux.
 * Events: `status` (snapshot on every state change), `log` ({ stream, line }, already redacted).
 */
class SoloistProcess extends EventEmitter {
  #spawn;
  #execFile;
  #fs;
  #platform;
  #clock;
  #env;
  #binaryPath;
  #state = 'stopped';
  #message = MESSAGES.stopped;
  #since;
  #device = null;
  #wsPort = null;
  #pid = null;
  #version = null;
  #config = null;
  #child = null;
  #restartTimer = null;
  #wsTimer = null;
  #wsGeneration = 0;
  #attempts = 0;
  #startedAt = 0;
  #stopRequested = false;
  #starting = false;
  #generation = 0;
  #disposed = false;
  #exitWaiters = [];
  #lines = [];

  /**
   * @param {object} [options]
   * @param {string} [options.binaryPath] Executable name or path (`settings.soloist.binaryPath`); defaults to `soloist` on PATH.
   * @param {Function} [options.spawn] `child_process.spawn`-compatible factory.
   * @param {Function} [options.execFile] `child_process.execFile`-compatible factory.
   * @param {object} [options.fs] Object exposing `promises`-style `readFile`, `rm`, `mkdir`.
   * @param {string} [options.platform] Defaults to `process.platform`.
   * @param {{now: Function, setTimeout: Function, clearTimeout: Function}} [options.clock]
   * @param {object} [options.env] Environment for the child; must not contain secrets.
   */
  constructor({
    binaryPath = 'soloist',
    spawn = childProcess.spawn,
    execFile = childProcess.execFile,
    fs = nodeFsPromises,
    platform = process.platform,
    clock = defaultClock,
    env = process.env
  } = {}) {
    super();
    this.#binaryPath = requireText(binaryPath, 'binaryPath', 4096);
    this.#spawn = spawn;
    this.#execFile = execFile;
    this.#fs = fs;
    this.#platform = platform;
    this.#clock = clock;
    this.#env = env;
    this.#since = clock.now();
  }

  /** Updates the executable used by future `detect()` and `start()` calls. */
  setBinaryPath(binaryPath) {
    this.#binaryPath = requireText(binaryPath, 'binaryPath', 4096);
  }

  /**
   * Checks the platform and runs `soloist --version` (no shell, 5 s timeout).
   * Resolves to `{ available, reason, path, version }`; `detail` is added when the probe failed.
   */
  async detect() {
    if (this.#platform !== 'linux') {
      return this.#rememberDetection({ available: false, reason: 'unsupported-platform', path: null, version: null });
    }
    const binary = this.#binaryPath;
    const result = await new Promise((resolve) => {
      const notInstalled = (detail) => resolve({ available: false, reason: 'not-installed', path: binary, version: null, detail });
      try {
        this.#execFile(binary, ['--version'], { shell: false, timeout: VERSION_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
          const version = parseVersion(stdout);
          if (error && !version) notInstalled(describeExecError(error));
          else resolve({ available: true, reason: 'ok', path: binary, version });
        });
      } catch (error) {
        notInstalled(describeExecError(error));
      }
    });
    return this.#rememberDetection(result);
  }

  /**
   * Starts Soloist and supervises it. Resolves with the status after the spawn attempt. The WebSocket endpoint is
   * resolved asynchronously: the state becomes `running` once it is published or the 10 s wait times out.
   */
  async start(options) {
    const config = validateStartOptions(options);
    if (this.#disposed) throw new Error('Soloist process controller has been disposed');
    if (this.#isActive()) return this.status();

    this.#config = config;
    this.#device = config.deviceName;
    this.#attempts = 0;
    this.#stopRequested = false;
    this.#starting = true;
    const generation = this.#generation;
    try {
      const detection = await this.detect();
      if (generation !== this.#generation) return this.status();
      if (!detection.available) {
        const unsupported = detection.reason === 'unsupported-platform';
        this.#setState(unsupported ? 'unsupported' : 'not-installed', unsupported ? MESSAGES.unsupported : MESSAGES.notInstalled);
        return this.status();
      }
      this.#version = detection.version;
      try {
        await this.#fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
        await this.#fs.mkdir(config.cacheDir, { recursive: true, mode: 0o700 });
      } catch (error) {
        if (generation === this.#generation) this.#setState('failed', `${MESSAGES.directories} (${String(error.code ?? 'error')})`);
        return this.status();
      }
      if (generation !== this.#generation) return this.status();
      await this.#spawnAttempt();
      return this.status();
    } finally {
      this.#starting = false;
    }
  }

  /** Sends SIGTERM, escalates to SIGKILL after 5 s, and resolves once the process has exited. */
  async stop() {
    this.#generation += 1;
    this.#stopRequested = true;
    this.#clearRestartTimer();
    this.#clearWsPoll();
    const child = this.#child;
    if (!child) {
      if (!this.#isTerminalState()) this.#setState('stopped', MESSAGES.stopped);
      return this.status();
    }
    const exited = new Promise((resolve) => { this.#exitWaiters.push(resolve); });
    try { child.kill('SIGTERM'); } catch { /* already gone; the exit event still resolves the wait */ }
    const escalation = this.#clock.setTimeout(() => {
      if (this.#child !== child) return;
      try { child.kill('SIGKILL'); } catch { /* process already gone */ }
    }, STOP_GRACE_MS);
    await exited;
    this.#clock.clearTimeout(escalation);
    return this.status();
  }

  /** Stops the process and prevents any further `start()`. Call from `app.on('will-quit')`. */
  dispose() {
    this.#disposed = true;
    return this.stop();
  }

  /** Returns the WebSocket URL once the process is running with a known port; otherwise null. */
  wsUrl() {
    if (this.#state !== 'running' || this.#wsPort === null) return null;
    return `ws://127.0.0.1:${this.#wsPort}`;
  }

  status() {
    return {
      state: this.#state,
      message: this.#message,
      device: this.#device,
      wsPort: this.#wsPort,
      pid: this.#pid,
      version: this.#version,
      since: this.#since
    };
  }

  /** Last redacted output lines (max 50) plus the current status. Never contains the API key. */
  diagnostics() {
    return { status: this.status(), lines: this.#lines.slice() };
  }

  #rememberDetection(result) {
    this.#version = result.available ? result.version : null;
    if (!this.#isActive()) {
      if (result.reason === 'unsupported-platform') this.#setState('unsupported', MESSAGES.unsupported);
      else if (!result.available) this.#setState('not-installed', MESSAGES.notInstalled);
      else if (this.#state === 'unsupported' || this.#state === 'not-installed') this.#setState('stopped', MESSAGES.stopped);
    }
    return result;
  }

  #isActive() {
    return Boolean(this.#child || this.#restartTimer || this.#starting);
  }

  #isTerminalState() {
    return this.#state === 'expired' || this.#state === 'failed' || this.#state === 'not-installed' || this.#state === 'unsupported';
  }

  #setState(state, message) {
    if (state === this.#state && message === this.#message) return;
    this.#state = state;
    this.#message = message;
    this.#since = this.#clock.now();
    this.emit('status', this.status());
  }

  #redact(text) {
    const key = this.#config?.apiKey;
    const value = String(text);
    return key ? value.split(key).join(REDACTION) : value;
  }

  #record(stream, rawLine) {
    const line = this.#redact(rawLine);
    this.#lines.push(line);
    if (this.#lines.length > LOG_LINE_LIMIT) this.#lines.splice(0, this.#lines.length - LOG_LINE_LIMIT);
    this.emit('log', { stream, line });
  }

  #attachOutput(stream, label) {
    if (!stream) return;
    let pending = '';
    stream.on('data', (chunk) => {
      const parts = (pending + chunk.toString('utf8')).split(/\r?\n/);
      pending = parts.pop() ?? '';
      for (const part of parts) this.#record(label, part);
      if (pending.length > MAX_PARTIAL_LINE) {
        // Keep a tail as long as the key so a key split across the flush boundary is never recorded whole.
        const keep = Math.max(1, this.#config?.apiKey.length ?? 1);
        const cut = pending.length - keep;
        this.#record(label, pending.slice(0, cut));
        pending = pending.slice(cut);
      }
    });
    stream.on('end', () => {
      if (pending) this.#record(label, pending);
      pending = '';
    });
  }

  async #spawnAttempt() {
    const generation = this.#generation;
    await removeWsFiles(this.#fs, this.#config.dataDir);
    if (generation !== this.#generation || this.#stopRequested) return;
    this.#launch();
  }

  #launch() {
    const config = this.#config;
    let child;
    try {
      child = this.#spawn(this.#binaryPath, buildArgs(config), {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: this.#env
      });
    } catch (error) {
      this.#finish(null, null, null, error);
      return;
    }
    this.#child = child;
    this.#pid = child.pid ?? null;
    this.#startedAt = this.#clock.now();
    this.#wsPort = config.wsPort > 0 ? config.wsPort : null;
    this.#attachOutput(child.stdout, 'stdout');
    this.#attachOutput(child.stderr, 'stderr');
    child.on('error', (error) => {
      if (this.#child === child) this.#finish(child, null, null, error);
    });
    child.on('exit', (code, signal) => {
      if (this.#child === child) this.#finish(child, code, signal, null);
    });
    this.#setState('starting', MESSAGES.starting);
    this.#awaitWsEndpoint(child);
  }

  /** Single exit path for both `exit` and `error` events (and synchronous spawn failures). */
  #finish(child, code, signal, error) {
    this.#child = null;
    this.#pid = null;
    this.#wsPort = null;
    this.#clearWsPoll();
    this.#handleExit(code ?? null, signal ?? null, error);
    const waiters = this.#exitWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  #handleExit(code, signal, error) {
    if (this.#stopRequested) {
      this.#setState('stopped', MESSAGES.stopped);
      return;
    }
    if (error?.code === 'ENOENT') {
      this.#setState('not-installed', MESSAGES.notInstalled);
      return;
    }
    if (code === EXIT_CODE_EXPIRED) {
      this.#setState('expired', MESSAGES.expired);
      return;
    }
    if (code === 0 && !signal && !error) {
      this.#setState('stopped', MESSAGES.exitedCleanly);
      return;
    }
    if (this.#clock.now() - this.#startedAt >= STABLE_RUN_MS) this.#attempts = 0;
    this.#attempts += 1;
    if (this.#attempts > MAX_RESTARTS) {
      this.#setState('failed', MESSAGES.failed);
      return;
    }
    const delay = backoffDelay(this.#attempts);
    const detail = describeExit(code, signal, error);
    this.#setState('crashed', `Soloist exited with ${detail}; restart ${this.#attempts}/${MAX_RESTARTS} in ${delay / 1000} s`);
    this.#restartTimer = this.#clock.setTimeout(() => {
      this.#restartTimer = null;
      void this.#spawnAttempt();
    }, delay);
  }

  #clearRestartTimer() {
    if (this.#restartTimer === null) return;
    this.#clock.clearTimeout(this.#restartTimer);
    this.#restartTimer = null;
  }

  #clearWsPoll() {
    this.#wsGeneration += 1;
    if (this.#wsTimer === null) return;
    this.#clock.clearTimeout(this.#wsTimer);
    this.#wsTimer = null;
  }

  #awaitWsEndpoint(child) {
    this.#clearWsPoll();
    const generation = this.#wsGeneration;
    const deadline = this.#clock.now() + WS_WAIT_MS;
    const check = async () => {
      this.#wsTimer = null;
      const port = await readWsPort(this.#fs, this.#config.dataDir);
      if (generation !== this.#wsGeneration || this.#child !== child || this.#state !== 'starting') return;
      if (port !== null) {
        this.#wsPort = port;
        this.#setState('running', MESSAGES.running);
        return;
      }
      if (this.#clock.now() >= deadline) {
        this.#setState('running', this.#config.wsPort > 0 ? MESSAGES.running : MESSAGES.wsUnpublished);
        return;
      }
      this.#wsTimer = this.#clock.setTimeout(check, WS_POLL_MS);
    };
    this.#wsTimer = this.#clock.setTimeout(check, 0);
  }
}

/** Asks the OS for a free loopback TCP port (used for `--ws 127.0.0.1:<port>`). */
function freePort({ net = nodeNet } = {}) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve(address.port);
      });
    });
  });
}

module.exports = {
  SoloistProcess,
  freePort,
  backoffDelay,
  buildArgs,
  validateStartOptions,
  parseWsAddress,
  EXIT_CODE_EXPIRED,
  MAX_RESTARTS,
  STOP_GRACE_MS,
  WS_WAIT_MS,
  MESSAGES
};
