'use strict';

const { EventEmitter } = require('node:events');
const { normaliseSoloistSettings } = require('./settings');

/** Soloist ships for Linux only. Elsewhere the feature reports `unsupported` and Spotify keeps working through the Web API. */
const UNSUPPORTED_PLATFORMS = new Set(['win32', 'darwin']);
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 30_000;
const MESSAGE_MAX = 160;

const isSupportedPlatform = (platform) => !UNSUPPORTED_PLATFORMS.has(platform);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mapDevice(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return undefined;
  return {
    id: raw.id.slice(0, 128),
    name: String(raw.name || 'Soloist').slice(0, 128),
    type: String(raw.type || 'computer').toLowerCase().slice(0, 32),
    active: raw.active !== false,
    ...(Number.isFinite(raw.volume) ? { volume: clamp(raw.volume, 0, 100) } : {})
  };
}

function mapTrack(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.uri !== 'string') return undefined;
  const artUrl = typeof raw.artUrl === 'string' && raw.artUrl.startsWith('https://') ? raw.artUrl.slice(0, 2048) : undefined;
  return {
    id: raw.id.slice(0, 64),
    uri: raw.uri.slice(0, 128),
    title: String(raw.title ?? '').slice(0, 256),
    artists: Array.isArray(raw.artists) ? raw.artists.filter((name) => typeof name === 'string').slice(0, 8).map((name) => name.slice(0, 128)) : [],
    album: String(raw.album ?? '').slice(0, 256),
    ...(artUrl ? { artUrl } : {}),
    durationMs: Number.isFinite(raw.durationMs) ? Math.max(0, raw.durationMs) : 0
  };
}

/**
 * Maps a Soloist WebSocket snapshot to the MediaState playback fields (pure). Unknown or malformed fields are dropped,
 * so nothing unexpected reaches the Spotify service or the renderer.
 * @param {unknown} raw
 * @returns {object | null}
 */
function mapSoloistPlayback(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const playing = raw.playing === true;
  const device = mapDevice(raw.device);
  const track = mapTrack(raw.track);
  const repeat = ['off', 'track', 'context'].includes(raw.repeat) ? raw.repeat : undefined;
  return {
    playing,
    ...(track ? { track } : {}),
    ...(Number.isFinite(raw.progressMs) ? { progressMs: Math.max(0, raw.progressMs) } : {}),
    ...(typeof raw.shuffle === 'boolean' ? { shuffle: raw.shuffle } : {}),
    ...(repeat ? { repeat } : {}),
    ...(Number.isFinite(raw.volume) ? { volume: clamp(raw.volume, 0, 100) } : {}),
    ...(device ? { device } : {}),
    idle: !playing && device?.active !== true
  };
}

/**
 * Lifecycle and integration of the local Soloist player (ns `soloist`). Owns one process handle and one socket client.
 * Process and client are injected (`createProcess()` -> backend/soloist/process.js, `createClient()` -> ws-client.js), so the
 * manager runs under test without binaries or sockets. The API key is held here only and is never emitted, logged or
 * included in an error message (see `#redact`).
 *
 * Events: `status` (SoloistStatus, on change), `state` (mapped playback snapshot from the socket), `connection` (boolean).
 * Provider methods (consumed by MediaService): isConnected(), deviceName(), onState(cb), onConnectionChange(cb).
 */
class SoloistManager extends EventEmitter {
  #platform;
  #createProcess;
  #createClient;
  #dataDir;
  #cacheDir;
  #reconnectMinMs;
  #reconnectMaxMs;
  #settings = normaliseSoloistSettings(undefined);
  #apiKey = '';
  #process = null;
  #client = null;
  #starting = null;
  #stopping = false;
  #processRunning = false;
  #processLoggedIn = null;
  #socketUp = false;
  #connected = false;
  #connecting = null;
  #reconnectTimer = null;
  #reconnectDelay;
  #error = '';
  #notInstalled = false;
  #lastStatusKey = '';

  /**
   * @param {{ platform?: string, createProcess?: () => any, createClient?: () => any, dataDir?: string, cacheDir?: string,
   *   reconnectMinMs?: number, reconnectMaxMs?: number }} [options]
   */
  constructor({ platform = process.platform, createProcess, createClient, dataDir = '', cacheDir = '', reconnectMinMs = RECONNECT_MIN_MS, reconnectMaxMs = RECONNECT_MAX_MS } = {}) {
    super();
    this.#platform = platform;
    this.#createProcess = createProcess;
    this.#createClient = createClient;
    this.#dataDir = dataDir;
    this.#cacheDir = cacheDir;
    this.#reconnectMinMs = reconnectMinMs;
    this.#reconnectMaxMs = reconnectMaxMs;
    this.#reconnectDelay = reconnectMinMs;
  }

  get supported() { return isSupportedPlatform(this.#platform); }

  /** Applies settings and the API key without touching the running process. */
  configure({ settings, apiKey } = {}) {
    this.#settings = normaliseSoloistSettings(settings);
    this.#apiKey = typeof apiKey === 'string' ? apiKey : '';
    this.#emitStatus();
  }

  /**
   * Brings the process in line with the settings: stops when disabled or unsupported, starts when enabled and not running,
   * restarts when the device name or binary path changed while running.
   */
  async reconcile({ settings, apiKey } = {}) {
    const before = this.#settings;
    const wasActive = this.#processRunning || this.#starting !== null;
    this.configure({ settings, apiKey });
    if (!this.supported || !this.#settings.enabled) {
      await this.stop();
      return this.status();
    }
    if (wasActive && (before.deviceName !== this.#settings.deviceName || before.binaryPath !== this.#settings.binaryPath)) {
      await this.restart();
    } else if (!this.#processRunning && !this.#starting) {
      await this.start();
    }
    return this.status();
  }

  /** Renderer-facing status. Never contains the API key, tokens or the binary path. */
  status() {
    return {
      state: this.#state(),
      platform: this.#platform,
      enabled: this.#settings.enabled,
      deviceName: this.#settings.deviceName,
      connected: this.#connected,
      ...(this.#error ? { message: this.#error } : {})
    };
  }

  #state() {
    if (!this.supported) return 'unsupported';
    if (!this.#settings.enabled) return 'disabled';
    if (this.#error) return 'error';
    if (this.#notInstalled) return 'not-installed';
    if (this.#processRunning) return this.#connected ? 'connected' : 'starting';
    return 'stopped';
  }

  /** Looks for the Soloist binary. Resolves `{ ok, supported, found }`. */
  async detect() {
    if (!this.supported) {
      this.#notInstalled = false;
      this.#emitStatus();
      return { ok: true, supported: false, found: false };
    }
    try {
      const proc = this.#ensureProcess();
      proc.setBinaryPath?.(this.#settings.binaryPath);
      const info = await proc.detect();
      const found = info?.available === true;
      this.#notInstalled = !found;
      this.#emitStatus();
      return { ok: true, supported: true, found };
    } catch (error) {
      return this.#fail('DETECT_FAILED', error);
    }
  }

  async start() {
    if (!this.supported) return { ok: false, code: 'UNSUPPORTED', error: 'Soloist is not supported on this platform.' };
    if (!this.#settings.enabled) return { ok: false, code: 'DISABLED', error: 'Soloist is disabled in settings.' };
    if (this.#processRunning) return { ok: true, status: this.status() };
    if (!this.#starting) this.#starting = this.#start().finally(() => { this.#starting = null; });
    return this.#starting;
  }

  async #start() {
    this.#error = '';
    this.#notInstalled = false;
    this.#stopping = false;
    if (!this.#apiKey) return this.#fail('NO_KEY', new Error('SPOTIFY_SOLOIST_API is not set.'));
    let proc;
    let detected;
    try {
      proc = this.#ensureProcess();
      proc.setBinaryPath?.(this.#settings.binaryPath);
      detected = await proc.detect();
    } catch (error) {
      return this.#fail('DETECT_FAILED', error);
    }
    if (detected?.available !== true) {
      this.#notInstalled = true;
      this.#emitStatus();
      return { ok: false, code: 'NOT_INSTALLED', error: 'Soloist was not found. Set settings.soloist.binaryPath.' };
    }
    try {
      this.#ensureClient();
      await proc.start({
        deviceName: this.#settings.deviceName,
        apiKey: this.#apiKey,
        dataDir: this.#dataDir,
        cacheDir: this.#cacheDir,
        binaryPath: this.#settings.binaryPath
      });
    } catch (error) {
      this.#dropClient();
      return this.#fail('START_FAILED', error);
    }
    this.#processRunning = true;
    await this.#connectSocket();
    this.#refreshConnected();
    return { ok: true, status: this.status() };
  }

  /** Stops the socket and the process. Safe to call when nothing runs. */
  async stop() {
    this.#clearReconnect();
    const proc = this.#process;
    const wasRunning = this.#processRunning;
    this.#stopping = true;
    this.#processRunning = false;
    this.#processLoggedIn = null;
    this.#dropClient();
    this.#error = '';
    this.#refreshConnected();
    if (proc && wasRunning) {
      try {
        await proc.stop();
      } catch (error) {
        this.#error = this.#redact(error);
      }
    }
    this.#emitStatus();
    return { ok: true, status: this.status() };
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  /** Stops everything and drops listeners. Called when the extension namespace stops. */
  async dispose() {
    await this.stop();
    this.removeAllListeners();
  }

  /* ---- provider API (MediaService) ---- */

  isConnected() { return this.#connected; }

  deviceName() { return this.#settings.deviceName; }

  /** @returns {() => void} unsubscribe */
  onState(listener) { this.on('state', listener); return () => { this.off('state', listener); }; }

  /** @returns {() => void} unsubscribe */
  onConnectionChange(listener) { this.on('connection', listener); return () => { this.off('connection', listener); }; }

  /* ---- internals ---- */

  #ensureProcess() {
    if (!this.#process) {
      if (typeof this.#createProcess !== 'function') throw new Error('Soloist process factory is not configured');
      const proc = this.#createProcess();
      proc.on('status', (status) => this.#onProcessStatus(proc, status));
      this.#process = proc;
    }
    return this.#process;
  }

  #ensureClient() {
    if (this.#client) return this.#client;
    if (typeof this.#createClient !== 'function') throw new Error('Soloist client factory is not configured');
    const client = this.#createClient();
    client.on('state', (snapshot) => {
      if (client !== this.#client) return;
      // X2 reconnects by itself; the connection flag is read from its snapshot, not from a disconnect event.
      const snap = typeof client.getSnapshot === 'function' ? client.getSnapshot() : { connected: true, loggedIn: true };
      const up = snap.connected === true && snap.loggedIn !== false;
      if (up !== this.#socketUp) { this.#socketUp = up; this.#refreshConnected(); }
      const mapped = mapSoloistPlayback(snapshot);
      if (mapped) this.emit('state', mapped);
    });
    this.#client = client;
    return client;
  }

  #dropClient() {
    const client = this.#client;
    this.#client = null;
    this.#socketUp = false;
    if (client) {
      try { client.dispose(); } catch { /* the socket is gone either way */ }
    }
  }

  /** Connects to the process WebSocket. Concurrent calls share one attempt; a failure schedules a backoff retry. */
  #connectSocket() {
    if (this.#connecting) return this.#connecting;
    this.#connecting = (async () => {
      this.#clearReconnect();
      try {
        const client = this.#ensureClient();
        const url = typeof this.#process?.wsUrl === 'function' ? this.#process.wsUrl() : null;
        if (!url) { this.#scheduleReconnect(); return false; }
        client.connect(url);
        if (client !== this.#client || !this.#processRunning) return false;
        this.#reconnectDelay = this.#reconnectMinMs;
        return true;
      } catch {
        this.#scheduleReconnect();
        return false;
      }
    })().finally(() => { this.#connecting = null; });
    return this.#connecting;
  }

  #scheduleReconnect() {
    if (this.#reconnectTimer || !this.#processRunning || this.#stopping) return;
    const delay = this.#reconnectDelay;
    this.#reconnectDelay = Math.min(this.#reconnectMaxMs, delay * 2);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (this.#processRunning && !this.#socketUp) void this.#connectSocket();
    }, delay);
    this.#reconnectTimer.unref?.();
  }

  #clearReconnect() {
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  #onProcessStatus(proc, status) {
    if (proc !== this.#process) return;
    const state = status?.state;
    if (typeof status?.loggedIn === 'boolean') this.#processLoggedIn = status.loggedIn;
    if (state === 'expired' || state === 'crashed' || state === 'failed' || state === 'not-installed' || state === 'unsupported') {
      this.#error = this.#redact(status.message || 'Soloist is not running.');
      this.#processRunning = false;
      this.#clearReconnect();
      this.#dropClient();
    } else if (state === 'error') {
      this.#error = this.#redact(status.message || 'Soloist reported an error.');
      this.#processRunning = false;
      this.#clearReconnect();
      this.#dropClient();
    } else if (state === 'stopped' || state === 'exited') {
      const unexpected = this.#processRunning && !this.#stopping;
      this.#processRunning = false;
      this.#clearReconnect();
      this.#dropClient();
      if (unexpected) this.#error = 'Soloist stopped unexpectedly.';
    } else if (state === 'running' && this.#processRunning && !this.#socketUp) {
      void this.#connectSocket();
    }
    this.#refreshConnected();
  }

  #refreshConnected() {
    const next = this.#processRunning && this.#socketUp && this.#processLoggedIn !== false;
    if (next !== this.#connected) {
      this.#connected = next;
      this.emit('connection', next);
    }
    this.#emitStatus();
  }

  #emitStatus() {
    const next = this.status();
    const key = JSON.stringify(next);
    if (key === this.#lastStatusKey) return;
    this.#lastStatusKey = key;
    this.emit('status', next);
  }

  #fail(code, error) {
    this.#error = this.#redact(error);
    this.#emitStatus();
    return { ok: false, code, error: this.#error };
  }

  /** Strips the API key from any text and bounds its length. The only path by which error text reaches the renderer. */
  #redact(error) {
    let text = String(error?.message ?? error ?? 'Soloist failed.');
    if (this.#apiKey) text = text.split(this.#apiKey).join('[redacted]');
    return text.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_MAX) || 'Soloist failed.';
  }
}

module.exports = { SoloistManager, mapSoloistPlayback, isSupportedPlatform };
