'use strict';

const { EventEmitter } = require('node:events');
const { buildCommand, parseMessage, repeatCommandSequence, QUERY_REPLY } = require('./protocol');
const { initialSnapshot, reduce, toMediaState } = require('./state');

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const COMMAND_TIMEOUT_MS = 5000;
const LOOPBACK_HOST = '127.0.0.1';

/** Reconnect delay for the nth consecutive failed attempt (0-based): 1 s, 2 s, 4 s ... capped at 30 s. */
function reconnectDelayMs(attempt) {
  return Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt));
}

/**
 * Accept only `ws://127.0.0.1:PORT`. Throws TypeError for anything else (wrong scheme, other host, credentials, garbage).
 * @param {string} url
 * @returns {string} The URL unchanged.
 */
function assertLoopbackUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError('Soloist URL is not a valid URL');
  }
  if (parsed.protocol !== 'ws:') throw new TypeError('Soloist URL must use ws://');
  if (parsed.hostname !== LOOPBACK_HOST) throw new TypeError(`Soloist URL must target ${LOOPBACK_HOST}`);
  if (parsed.username || parsed.password) throw new TypeError('Soloist URL must not contain credentials');
  return url;
}

/** @param {unknown} data WebSocket frame payload. Only text is meaningful for this protocol. */
function frameText(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return null;
}

/**
 * Client for one local Soloist WebSocket. Owns the reconnect loop and command correlation; holds no tokens and logs
 * only lifecycle transitions (never message bodies).
 *
 * Events:
 * - `'state'` (MediaState): emitted when the MediaState-visible snapshot changes (ignores `updatedAt`).
 * - `'event'` (parsed protocol event): every inbound event, including command_result, error and malformed frames.
 */
class SoloistClient extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {new (url: string) => { send(data: string): void, close(code?: number): void, onopen: ((ev: unknown) => void) | null, onmessage: ((ev: { data: unknown }) => void) | null, onclose: ((ev: unknown) => void) | null, onerror: ((ev: unknown) => void) | null }} [options.WebSocketImpl] Defaults to the global WebSocket.
   * @param {{ now?: () => number, setTimeout?: (fn: () => void, ms: number) => unknown, clearTimeout?: (handle: unknown) => void }} [options.clock]
   * @param {(message: string) => void} [options.logger] Receives lifecycle strings only.
   * @param {number} [options.commandTimeoutMs=5000]
   */
  constructor({ WebSocketImpl = globalThis.WebSocket, clock = {}, logger = null, commandTimeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    super();
    if (typeof WebSocketImpl !== 'function') throw new TypeError('No WebSocket constructor available');
    this.WebSocketImpl = WebSocketImpl;
    this.now = clock.now ?? (() => Date.now());
    this.setTimer = clock.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = clock.clearTimeout ?? ((handle) => clearTimeout(handle));
    this.logger = logger;
    this.commandTimeoutMs = commandTimeoutMs;
    this.url = null;
    this.socket = null;
    this.connected = false;
    this.disposed = false;
    this.attempt = 0;
    this.reconnectTimer = null;
    /** @type {Array<{ command: string, expect: string, resolve: (result: object) => void, timer: unknown }>} */
    this.pending = [];
    this.snapshot = initialSnapshot();
    this.lastStateKey = null;
  }

  /** Current snapshot (the reducer output; treat as read-only). */
  getSnapshot() {
    return this.snapshot;
  }

  /** MediaState-compatible view of the current snapshot at the injected clock time. */
  getMediaState() {
    return toMediaState(this.snapshot, this.now());
  }

  /**
   * Start (or restart) the connection. The URL is validated synchronously; a rejected URL never opens a socket.
   * @param {string} url e.g. `ws://127.0.0.1:8765`
   * @throws {TypeError} non-loopback, non-ws or malformed URL; Error after dispose().
   */
  connect(url) {
    if (this.disposed) throw new Error('SoloistClient is disposed');
    this.url = assertLoopbackUrl(url);
    this.#clearReconnect();
    this.#closeSocket();
    this.attempt = 0;
    this.#open();
  }

  /**
   * Send a command and resolve with its outcome. Never rejects.
   * - Control commands resolve on `command_result` (accepted, not necessarily applied).
   * - Query commands (get_auth_state, get_state, get_queue) resolve on their reply event; the result carries `event`.
   * - Results: `{ ok: true, command }` | `{ ok: false, code, command?, error? }` with code DISCONNECTED, INVALID,
   *   TIMEOUT, SERVER_ERROR (server `error` event, rejects the oldest pending command) or SEND_FAILED.
   * @param {string} command Wire command name, e.g. 'pause' or 'seek'.
   * @param {Record<string, unknown>} [fields]
   * @returns {Promise<{ ok: boolean, command?: string, code?: string, error?: string, event?: object }>}
   */
  send(command, fields = {}) {
    if (this.disposed || !this.connected || !this.socket) {
      return Promise.resolve({ ok: false, code: 'DISCONNECTED', command });
    }
    let message;
    try {
      message = buildCommand(command, fields);
    } catch (error) {
      return Promise.resolve({ ok: false, code: 'INVALID', command, error: error instanceof Error ? error.message : 'Invalid command' });
    }
    const socket = this.socket;
    return new Promise((resolve) => {
      const entry = { command, expect: QUERY_REPLY[command] ?? 'command_result', resolve, timer: null };
      entry.timer = this.setTimer(() => {
        this.#removePending(entry);
        resolve({ ok: false, code: 'TIMEOUT', command });
      }, this.commandTimeoutMs);
      this.pending.push(entry);
      try {
        socket.send(JSON.stringify(message));
      } catch {
        this.#removePending(entry);
        resolve({ ok: false, code: 'SEND_FAILED', command });
      }
    });
  }

  /**
   * Set repeat mode with the two-command sequence, awaiting each step.
   * @param {'off'|'context'|'track'} mode
   * @returns {Promise<{ ok: boolean, command?: string, code?: string, error?: string }>} First failing step, or `{ ok: true }`.
   */
  async repeat(mode) {
    let steps;
    try {
      steps = repeatCommandSequence(mode);
    } catch (error) {
      return { ok: false, code: 'INVALID', error: error instanceof Error ? error.message : 'Invalid repeat mode' };
    }
    for (const step of steps) {
      const result = await this.send(step.command, step.fields);
      if (!result.ok) return result;
    }
    return { ok: true, command: 'repeat' };
  }

  /** Close the socket, cancel reconnects and fail all pending commands. Idempotent. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.#clearReconnect();
    this.#failPending('DISCONNECTED');
    this.#closeSocket();
    this.#log('disposed');
  }

  #log(message) {
    if (this.logger) this.logger(`soloist: ${message}`);
  }

  #open() {
    if (this.disposed) return;
    let socket;
    try {
      socket = new this.WebSocketImpl(this.url);
    } catch {
      this.#log('socket construction failed');
      this.#scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.attempt = 0;
      this.#log('connected');
      this.#setConnected(true);
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket) return;
      this.#handleFrame(event?.data);
    };
    socket.onerror = () => {
      if (socket !== this.socket) return;
      this.#log('socket error');
    };
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.#log('disconnected');
      this.#setConnected(false);
      this.#failPending('DISCONNECTED');
      this.#scheduleReconnect();
    };
  }

  /** Remove handlers, close the socket and forget it so late events from it are ignored. */
  #closeSocket() {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close(1000);
      } catch {
        // Already closed or closing; nothing further to release.
      }
    }
    if (this.connected) this.#setConnected(false);
  }

  #scheduleReconnect() {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = reconnectDelayMs(this.attempt);
    this.attempt += 1;
    this.#log(`reconnect in ${delay} ms`);
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null;
      this.#open();
    }, delay);
  }

  #clearReconnect() {
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  #setConnected(connected) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.#apply({ type: 'connection', connected });
  }

  #handleFrame(data) {
    const event = parseMessage(frameText(data));
    if (event.type === 'command_result') {
      this.#settle((entry) => entry.expect === 'command_result' && entry.command === event.command, { ok: true, command: event.command });
    } else if (event.type === 'error' && !event.malformed) {
      this.#settleOldest({ ok: false, code: 'SERVER_ERROR', error: event.message });
    } else if (Object.values(QUERY_REPLY).includes(event.type)) {
      this.#settle((entry) => entry.expect === event.type, null, event);
    }
    this.#apply(event);
    this.emit('event', event);
  }

  /** Resolve the first pending entry matching `predicate`. `result` may be null; then `{ ok: true, command, event }` is built. */
  #settle(predicate, result, event) {
    const entry = this.pending.find(predicate);
    if (!entry) return false;
    this.#removePending(entry);
    entry.resolve(result ?? { ok: true, command: entry.command, event });
    return true;
  }

  #settleOldest(result) {
    const entry = this.pending[0];
    if (!entry) return;
    this.#removePending(entry);
    entry.resolve({ ...result, command: entry.command });
  }

  #removePending(entry) {
    const index = this.pending.indexOf(entry);
    if (index !== -1) this.pending.splice(index, 1);
    if (entry.timer !== null) this.clearTimer(entry.timer);
    entry.timer = null;
  }

  #failPending(code) {
    const entries = this.pending.splice(0);
    for (const entry of entries) {
      if (entry.timer !== null) this.clearTimer(entry.timer);
      entry.timer = null;
      entry.resolve({ ok: false, code, command: entry.command });
    }
  }

  /** Apply an event to the snapshot and emit `state` when the MediaState-visible part changed. */
  #apply(event) {
    const now = this.now();
    this.snapshot = reduce(this.snapshot, event, now);
    const media = toMediaState(this.snapshot, now);
    const { updatedAt, ...stable } = media;
    const key = JSON.stringify(stable);
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;
    this.emit('state', media);
  }
}

module.exports = { SoloistClient, reconnectDelayMs, assertLoopbackUrl, RECONNECT_BASE_MS, RECONNECT_MAX_MS, COMMAND_TIMEOUT_MS };
