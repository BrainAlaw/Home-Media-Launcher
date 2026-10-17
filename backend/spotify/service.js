'use strict';

const path = require('node:path');
const { atomicWrite, readJson, serialize } = require('../storage');
const { SpotifyAuth } = require('./auth');
const { createClient } = require('./client');

const POLL_PLAYING_MS = 1000;
const POLL_PAUSED_MS = 5000;
const POLL_IDLE_MS = 15_000;
const POLL_HIDDEN_MS = 15_000;
const POLL_SUSPENDED_CHECK_MS = 2000;
const POLL_MAX_BACKOFF_MS = 60_000;
const POST_COMMAND_REFRESH_MS = 350;
/** Progress is re-emitted only when it drifts further than this from the interpolated position (seek, track change). */
const DRIFT_EMIT_MS = 2500;
const FRESH_STATE_MS = 1500;

/** Delay until the next poll: ~1 s playing, 5 s paused, 15 s idle or hidden, exponential backoff on failures, never before a 429 expires. */
function pollInterval({ suspended, visible, playback, failures = 0, waitMs = 0 }) {
  if (suspended) return POLL_SUSPENDED_CHECK_MS;
  let base = POLL_IDLE_MS;
  if (playback.playing) base = visible ? POLL_PLAYING_MS : POLL_HIDDEN_MS;
  else if (!playback.idle) base = visible ? POLL_PAUSED_MS : POLL_HIDDEN_MS;
  const backoff = failures ? Math.min(POLL_MAX_BACKOFF_MS, base * 2 ** Math.min(failures, 6)) : base;
  return Math.max(backoff, waitMs);
}

/**
 * Orchestrates auth, the Spotify client, adaptive polling, the on-disk state cache and the `media` events.
 * All side effects are injected so it can run under test without Electron or a network.
 */
class MediaService {
  constructor({ clientId, userData, fetch: fetchImpl = globalThis.fetch, safeStorage, openExternal, emit = () => {}, isSuspended = () => false,
    isVisible = () => true, now = Date.now, sleep, ports, loginTimeoutMs, createServer } = {}) {
    this.now = now;
    this.emit = emit;
    this.isSuspended = isSuspended;
    this.isVisible = isVisible;
    this.cachePath = userData ? path.join(userData, 'media-state.json') : '';
    this.lastDeviceId = '';
    this.timer = null;
    this.stopped = true;
    this.failures = 0;
    this.pollInflight = null;
    this.lastEmitted = '';
    this.lastEmittedAt = 0;
    this.lastEmittedProgress = 0;
    this.lastEmittedPlaying = false;
    this.retryNotBefore = 0;
    this.playback = { playing: false, idle: true };
    this.stale = false;
    this.fetchedAt = 0;
    /** Whether the renderer shows any media UI. Polling runs only while true; inactive until the renderer reports otherwise. */
    this.active = false;
    this.authState = clientId ? { status: 'signed-out' } : { status: 'unconfigured' };
    this.auth = new SpotifyAuth({ clientId, fetch: fetchImpl, safeStorage, tokenPath: userData ? path.join(userData, 'spotify-tokens.json') : '', openExternal, ports, loginTimeoutMs, createServer, now });
    this.client = createClient({ auth: this.auth, fetch: fetchImpl, sleep, now, openApp: () => (openExternal ? openExternal('spotify:') : Promise.reject(new Error('No launcher'))), getLastDeviceId: () => this.lastDeviceId });
    this.auth.onChange((event) => { void this.#onAuth(event); });
  }

  /** The renderer-facing state. Contains no tokens by construction: only mapped playback fields and the auth status. */
  get state() {
    return { auth: this.authState, ...this.playback, ...(this.stale ? { stale: true } : {}), updatedAt: this.fetchedAt || this.now() };
  }

  async start({ autoPoll = true } = {}) {
    this.stopped = false;
    this.autoPoll = autoPoll;
    if (!this.auth.configured) { this.authState = { status: 'unconfigured' }; return; }
    await this.#loadCache();
    if (await this.auth.init()) {
      await this.#enterSignedIn();
      if (autoPoll) this.#schedule(0);
    } else {
      this.authState = { status: 'signed-out' };
      this.playback = { playing: false, idle: true };
      this.stale = false;
      this.#publish();
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.auth.dispose();
  }

  async #loadCache() {
    if (!this.cachePath) return;
    try {
      const cached = await readJson(this.cachePath, null);
      if (cached && typeof cached === 'object') {
        if (typeof cached.lastDeviceId === 'string') this.lastDeviceId = cached.lastDeviceId;
        if (cached.playback && typeof cached.playback === 'object') {
          // Cached state is shown immediately but never claims the track is still playing.
          this.playback = { ...cached.playback, playing: false };
          this.stale = true;
          this.fetchedAt = Number(cached.updatedAt) || 0;
        }
      }
    } catch { /* an unreadable cache is ignored */ }
  }

  #saveCache() {
    if (!this.cachePath) return;
    const payload = JSON.stringify({ version: 1, lastDeviceId: this.lastDeviceId, playback: this.playback, updatedAt: this.fetchedAt });
    void serialize(this.cachePath, () => atomicWrite(this.cachePath, payload)).catch(() => {});
  }

  async #enterSignedIn() {
    const profile = await this.client.me();
    if (profile.ok) this.authState = { status: 'signed-in', displayName: profile.displayName };
    else if (profile.code === 'AUTH' && !profile.offline) { this.authState = { status: 'signed-out' }; }
    else this.authState = { status: 'signed-in', displayName: this.authState.displayName || 'Spotify' };
    this.emit('auth', this.authState);
    this.#publish();
  }

  async #onAuth(event) {
    if (event.status === 'signing-in') this.authState = { status: 'signing-in', url: event.url };
    else if (event.status === 'error') this.authState = { status: 'error', message: event.message };
    else if (event.status === 'signed-out') {
      this.authState = { status: 'signed-out' };
      this.playback = { playing: false, idle: true };
      this.stale = false;
      this.fetchedAt = 0;
      clearTimeout(this.timer);
      this.timer = null;
      this.#saveCache();
    } else if (event.status === 'signed-in') {
      await this.#enterSignedIn();
      this.failures = 0;
      this.retryNotBefore = 0;
      if (!this.stopped && this.autoPoll !== false) this.#schedule(0);
      return;
    }
    this.emit('auth', this.authState);
    this.#publish();
  }

  #publish() {
    const state = this.state;
    const { updatedAt, progressMs, ...rest } = state;
    const signature = JSON.stringify(rest);
    let changed = false;
    if (signature !== this.lastEmitted) changed = true;
    else if (state.playing && Number.isFinite(progressMs)) {
      const expected = this.lastEmittedProgress + (this.lastEmittedPlaying ? updatedAt - this.lastEmittedAt : 0);
      if (Math.abs(progressMs - expected) > DRIFT_EMIT_MS) changed = true;
    }
    if (!changed) return;
    this.lastEmitted = signature;
    this.lastEmittedAt = updatedAt;
    this.lastEmittedProgress = progressMs || 0;
    this.lastEmittedPlaying = state.playing;
    this.emit('state', state);
  }

  #interval() {
    return pollInterval({ suspended: this.isSuspended(), visible: this.isVisible(), playback: this.playback, failures: this.failures, waitMs: this.retryNotBefore - this.now() });
  }

  #schedule(delay) {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || !this.active || !this.auth.signedIn) return;
    this.timer = setTimeout(() => { void this.#tick(); }, delay);
    this.timer.unref?.();
  }

  async #tick() {
    // No network while a launched application owns the screen.
    if (!this.isSuspended()) await this.refresh();
    this.#schedule(this.#interval());
  }

  /**
   * Renderer report: true while any media UI is visible (widget enabled on the home view, or the music view open).
   * Activation fetches immediately; deactivation cancels the poll timer so no request is made while nothing is shown.
   * Auth and token refresh are event driven (no heartbeat needed) and the on-disk state cache keeps working.
   */
  setActive(active) {
    const next = active === true;
    if (next === this.active) return { ok: true, active: next };
    this.active = next;
    if (!next) { clearTimeout(this.timer); this.timer = null; }
    else if (!this.stopped && this.autoPoll !== false) this.#schedule(0);
    return { ok: true, active: next };
  }

  /** Fetches the playback state once (single-flight). Never throws; offline keeps the last known state and flags it stale. */
  refresh() {
    if (!this.auth.signedIn) return Promise.resolve(this.state);
    if (this.pollInflight) return this.pollInflight;
    this.pollInflight = (async () => {
      const result = await this.client.getState();
      if (result.ok) {
        this.failures = 0;
        this.stale = false;
        this.playback = result.playback;
        this.fetchedAt = this.now();
        if (result.playback.device?.id) this.lastDeviceId = result.playback.device.id;
        this.#saveCache();
      } else if (result.code === 'AUTH' && !result.offline) {
        // Token rejected for good: auth already emitted signed-out when the refresh token was revoked.
        this.failures += 1;
      } else {
        this.failures += 1;
        this.stale = true;
        if (result.retryAfterMs) this.retryNotBefore = this.now() + result.retryAfterMs;
      }
      this.#publish();
      return this.state;
    })().catch(() => this.state).finally(() => { this.pollInflight = null; });
    return this.pollInflight;
  }

  /** Playback snapshot for toggle-style commands; refreshes first when the cached state is old. */
  async #freshSnapshot() {
    if (this.now() - this.fetchedAt > FRESH_STATE_MS) await this.refresh();
    return { playing: this.playback.playing, shuffle: this.playback.shuffle, repeat: this.playback.repeat, volume: this.playback.volume };
  }

  #afterCommand(result) {
    if (!this.stopped && this.active && this.auth.signedIn) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { void this.#tick(); }, POST_COMMAND_REFRESH_MS);
      this.timer.unref?.();
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error, code: result.code };
  }

  #guard() {
    if (!this.auth.configured) return { ok: false, code: 'UNCONFIGURED', error: 'SPOTIFY_CLIENT_ID is not set' };
    if (!this.auth.signedIn) return { ok: false, code: 'AUTH', error: 'Not signed in to Spotify.' };
    return null;
  }

  /* ---- handlers (ns `media`) ---- */

  status() { return this.state; }

  async login() {
    const result = await this.auth.login();
    return result.ok ? { ok: true, url: result.url } : { ok: false, error: result.error };
  }

  async logout() {
    await this.auth.logout();
    return { ok: true };
  }

  async nowPlaying() {
    return this.#guard() ? this.state : this.refresh();
  }

  async control(command) {
    const blocked = this.#guard();
    if (blocked) return blocked;
    const snapshot = ['toggle', 'shuffle', 'repeat', 'volume-up', 'volume-down'].includes(command) ? await this.#freshSnapshot() : {};
    return this.#afterCommand(await this.client.control(command, snapshot));
  }

  async setVolume(percent) {
    return this.#guard() || this.#afterCommand(await this.client.setVolume(percent));
  }

  async devices() {
    const blocked = this.#guard();
    if (blocked) return { ...blocked, devices: [] };
    const result = await this.client.devices();
    return result.ok ? { ok: true, devices: result.devices } : { ok: false, error: result.error, code: result.code, devices: [] };
  }

  async transfer(deviceId) {
    const blocked = this.#guard();
    if (blocked) return blocked;
    const result = await this.client.transfer(deviceId, true);
    if (result.ok) this.lastDeviceId = deviceId;
    return this.#afterCommand(result);
  }

  async search(query, types) {
    const blocked = this.#guard();
    const empty = { tracks: [], albums: [], playlists: [], artists: [] };
    if (blocked) return { ...blocked, results: empty };
    const result = await this.client.search(query, types);
    return result.ok ? { ok: true, results: result.results } : { ok: false, error: result.error, code: result.code, results: empty };
  }

  async playlists(offset) {
    const blocked = this.#guard();
    if (blocked) return { ...blocked, items: [], total: 0, offset: 0, nextOffset: null };
    const result = await this.client.playlists(offset);
    return result.ok ? result : { ok: false, error: result.error, code: result.code, items: [], total: 0, offset: 0, nextOffset: null };
  }

  async playlistTracks(id, offset) {
    const blocked = this.#guard();
    if (blocked) return { ...blocked, items: [], total: 0, offset: 0, nextOffset: null };
    const result = await this.client.playlistTracks(id, offset);
    return result.ok ? result : { ok: false, error: result.error, code: result.code, items: [], total: 0, offset: 0, nextOffset: null };
  }

  async play(request) {
    return this.#guard() || this.#afterCommand(await this.client.play(request));
  }

  async openSpotifyApp() {
    return this.#guard() || this.#afterCommand(await this.client.openSpotifyApp());
  }
}

module.exports = { MediaService, pollInterval, POLL_PLAYING_MS, POLL_PAUSED_MS, POLL_IDLE_MS };
