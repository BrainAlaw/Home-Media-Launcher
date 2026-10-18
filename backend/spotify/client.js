'use strict';

const { mapPlayback, mapDevice, mapPlaylist, mapPlaylistTracks, mapSearch, mapForYou } = require('./mappers');

const API_BASE = 'https://api.spotify.com/v1';
const REQUEST_TIMEOUT_MS = 10_000;
/** A 429 is waited out inline only when Retry-After is short; longer waits fail fast so the UI never hangs. */
const MAX_INLINE_WAIT_MS = 10_000;
const MAX_RATE_RETRIES = 2;
const PAGE_SIZE = 50;
const SEARCH_LIMIT = 10;
const VOLUME_STEP = 10;
const SEARCH_TYPES = Object.freeze(['track', 'album', 'playlist', 'artist']);
const URI_PATTERN = /^spotify:(?:track|album|playlist|artist|episode|show):[A-Za-z0-9]+$/;
const APP_START_TIMEOUT_MS = 8000;
const APP_POLL_MS = 1000;
/** Spotify cycles repeat as off -> context -> track -> off. */
const REPEAT_NEXT = Object.freeze({ off: 'context', context: 'track', track: 'off' });

const FRIENDLY = Object.freeze({
  PREMIUM_REQUIRED: 'Spotify Premium is required to control playback.',
  NO_ACTIVE_DEVICE: 'No active Spotify device. Open Spotify and try again.',
  VOLUME_CONTROL_DISALLOW: 'This device does not allow volume control.',
  NO_DEVICE: 'No Spotify device available. Open Spotify and try again.',
  RATE_LIMITED: 'Spotify is rate limiting requests. Try again shortly.',
  OFFLINE: 'Spotify is unreachable.',
  AUTH: 'Not signed in to Spotify.'
});

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const failure = (code, extra = {}) => ({ ok: false, code, error: FRIENDLY[code] || code, ...extra });

/**
 * Builds the HTTP request for a transport command from the last known playback snapshot (pure, unit tested).
 * Returns `{ method, path, query? }` or `{ error }`.
 */
function planCommand(command, snapshot = {}) {
  switch (command) {
    case 'play': return { method: 'PUT', path: '/me/player/play' };
    case 'pause': return { method: 'PUT', path: '/me/player/pause' };
    case 'toggle': return snapshot.playing ? { method: 'PUT', path: '/me/player/pause' } : { method: 'PUT', path: '/me/player/play' };
    case 'next': return { method: 'POST', path: '/me/player/next' };
    case 'previous': return { method: 'POST', path: '/me/player/previous' };
    case 'shuffle': return { method: 'PUT', path: '/me/player/shuffle', query: { state: String(!snapshot.shuffle) } };
    case 'repeat': return { method: 'PUT', path: '/me/player/repeat', query: { state: REPEAT_NEXT[snapshot.repeat] || 'context' } };
    case 'volume-up':
    case 'volume-down': {
      const current = Number.isFinite(snapshot.volume) ? snapshot.volume : 50;
      const delta = command === 'volume-up' ? VOLUME_STEP : -VOLUME_STEP;
      return { method: 'PUT', path: '/me/player/volume', query: { volume_percent: String(clamp(current + delta, 0, 100)) } };
    }
    default: return { error: `Unknown media command: ${command}` };
  }
}

/** Body for PUT /me/player/play, validated against Spotify URI syntax. Returns `{ body, query }` or `{ error }`. */
function buildPlayRequest(request = {}) {
  const body = {};
  if (request.contextUri !== undefined) {
    if (typeof request.contextUri !== 'string' || !URI_PATTERN.test(request.contextUri)) return { error: 'Invalid Spotify context URI' };
    body.context_uri = request.contextUri;
  }
  if (request.uris !== undefined) {
    if (!Array.isArray(request.uris) || !request.uris.length || request.uris.length > 100 || !request.uris.every((uri) => typeof uri === 'string' && URI_PATTERN.test(uri))) return { error: 'Invalid Spotify URI list' };
    if (body.context_uri) return { error: 'Use either contextUri or uris, not both' };
    body.uris = request.uris;
  }
  if (request.offsetUri !== undefined) {
    if (typeof request.offsetUri !== 'string' || !URI_PATTERN.test(request.offsetUri)) return { error: 'Invalid Spotify offset URI' };
    body.offset = { uri: request.offsetUri };
  }
  const query = {};
  if (request.deviceId !== undefined) {
    if (typeof request.deviceId !== 'string' || !/^[\w-]{1,128}$/.test(request.deviceId)) return { error: 'Invalid device id' };
    query.device_id = request.deviceId;
  }
  return { body: Object.keys(body).length ? body : undefined, query };
}

/**
 * Spotify Web API client. Pure with injected collaborators:
 * `auth` = { getAccessToken(), refresh() }, `fetch`, `sleep`, `now`, `openApp()` (launches the desktop app), `getLastDeviceId()`.
 * Every method resolves to `{ ok: true, ... }` or `{ ok: false, code, error }`; nothing throws to the caller.
 */
function createClient({ auth, fetch: fetchImpl = globalThis.fetch, sleep = defaultSleep, now = Date.now, openApp, getLastDeviceId = () => '' } = {}) {
  let blockedUntil = 0;

  async function request(method, path, { query, body } = {}) {
    let refreshed = false;
    let rateRetries = 0;
    for (;;) {
      const wait = blockedUntil - now();
      if (wait > 0) {
        if (wait > MAX_INLINE_WAIT_MS) return failure('RATE_LIMITED', { status: 429, retryAfterMs: wait });
        await sleep(wait);
      }
      let token;
      try { token = await auth.getAccessToken(); } catch { token = null; }
      if (!token) return failure('AUTH', { status: 401 });
      const url = new URL(API_BASE + path);
      if (query) for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
      let response;
      try {
        response = await fetchImpl(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
      } catch {
        return failure('OFFLINE', { offline: true });
      }
      if (response.status === 401 && !refreshed) {
        refreshed = true;
        const result = await auth.refresh();
        if (result.ok) continue;
        return failure('AUTH', { status: 401, offline: Boolean(result.offline) });
      }
      if (response.status === 429) {
        const seconds = Number(response.headers?.get?.('retry-after'));
        const delay = Math.max(1000, (Number.isFinite(seconds) ? seconds : 1) * 1000);
        blockedUntil = now() + delay;
        if (rateRetries++ >= MAX_RATE_RETRIES) return failure('RATE_LIMITED', { status: 429, retryAfterMs: delay });
        continue;
      }
      let text = '';
      try { text = await response.text(); } catch { /* treated as empty body */ }
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch { data = null; } }
      if (response.ok) return { ok: true, status: response.status, data };
      const reason = String(data?.error?.reason || '');
      const message = String(data?.error?.message || '');
      let code = reason || `HTTP_${response.status}`;
      if (response.status === 404 && (reason === 'NO_ACTIVE_DEVICE' || /no active device/i.test(message))) code = 'NO_ACTIVE_DEVICE';
      let error = FRIENDLY[code];
      if (!error) {
        if (response.status === 403) error = 'Spotify refused the request. Check that your account is on the app user list and has Premium.';
        else if (response.status === 404) error = 'Spotify could not find that item or device.';
        else error = `Spotify request failed (HTTP ${response.status}).`;
      }
      return { ok: false, status: response.status, code, error };
    }
  }

  const unwrap = (result, extra) => (result.ok ? { ok: true, ...extra(result.data) } : result);

  async function me() {
    return unwrap(await request('GET', '/me'), (data) => ({ displayName: String(data?.display_name || data?.id || 'Spotify user') }));
  }

  async function getState() {
    return unwrap(await request('GET', '/me/player', { query: { additional_types: 'track,episode' } }), (data) => ({ playback: mapPlayback(data) }));
  }

  async function devices() {
    return unwrap(await request('GET', '/me/player/devices'), (data) => ({ devices: (data?.devices || []).map(mapDevice).filter(Boolean) }));
  }

  async function transfer(deviceId, play = true) {
    if (typeof deviceId !== 'string' || !/^[\w-]{1,128}$/.test(deviceId)) return { ok: false, code: 'INVALID', error: 'Invalid device id' };
    return request('PUT', '/me/player', { body: { device_ids: [deviceId], play } });
  }

  /** Launches the Spotify desktop app and transfers playback to the first device that appears (up to 8 s). */
  async function openSpotifyApp() {
    if (!openApp) return failure('NO_DEVICE');
    try { await openApp(); } catch { return { ok: false, code: 'APP_LAUNCH', error: 'Could not open the Spotify app.' }; }
    const deadline = now() + APP_START_TIMEOUT_MS;
    for (;;) {
      const listing = await devices();
      if (!listing.ok && listing.code === 'AUTH') return listing;
      const target = listing.ok ? pickDevice(listing.devices) : undefined;
      if (target) {
        const moved = await transfer(target.id, true);
        return moved.ok ? { ok: true, deviceId: target.id } : moved;
      }
      if (now() >= deadline) return failure('NO_DEVICE');
      await sleep(APP_POLL_MS);
    }
  }

  function pickDevice(list) {
    const lastId = getLastDeviceId();
    return list.find((device) => device.active) || list.find((device) => device.id === lastId) || list[0];
  }

  /** Recovery for 'no active device': transfer to the active, last used or first device; optionally launch the app. */
  async function recoverDevice({ launch }) {
    const listing = await devices();
    if (listing.ok && listing.devices.length) {
      const moved = await transfer(pickDevice(listing.devices).id, true);
      if (moved.ok) { await sleep(500); return { ok: true }; }
      return moved;
    }
    if (!listing.ok && listing.code !== 'HTTP_404') return listing;
    if (!launch) return failure('NO_ACTIVE_DEVICE');
    const opened = await openSpotifyApp();
    if (opened.ok) await sleep(500);
    return opened;
  }

  /** Sends a player request and, on NO_ACTIVE_DEVICE, recovers once and retries. `launch` allows starting the desktop app. */
  async function withDeviceRecovery(send, { launch }) {
    const first = await send();
    if (first.ok || first.code !== 'NO_ACTIVE_DEVICE') return first;
    const recovered = await recoverDevice({ launch });
    if (!recovered.ok) return recovered.code === 'NO_DEVICE' || recovered.code === 'NO_ACTIVE_DEVICE' ? recovered : first;
    return send();
  }

  async function control(command, snapshot = {}) {
    const plan = planCommand(command, snapshot);
    if (plan.error) return { ok: false, code: 'INVALID', error: plan.error };
    const startsPlayback = plan.path === '/me/player/play';
    return withDeviceRecovery(() => request(plan.method, plan.path, { query: plan.query }), { launch: startsPlayback });
  }

  async function setVolume(percent, deviceId) {
    const value = Number(percent);
    if (!Number.isFinite(value)) return { ok: false, code: 'INVALID', error: 'Invalid volume' };
    const query = { volume_percent: Math.round(clamp(value, 0, 100)), ...(deviceId ? { device_id: deviceId } : {}) };
    return withDeviceRecovery(() => request('PUT', '/me/player/volume', { query }), { launch: false });
  }

  async function play(requestInput) {
    const built = buildPlayRequest(requestInput || {});
    if (built.error) return { ok: false, code: 'INVALID', error: built.error };
    return withDeviceRecovery(() => request('PUT', '/me/player/play', { query: built.query, body: built.body }), { launch: true });
  }

  async function search(query, types = SEARCH_TYPES) {
    const text = typeof query === 'string' ? query.trim().slice(0, 200) : '';
    if (!text) return { ok: true, results: mapSearch({}) };
    const wanted = (Array.isArray(types) ? types : SEARCH_TYPES).filter((type) => SEARCH_TYPES.includes(type));
    const result = await request('GET', '/search', { query: { q: text, type: (wanted.length ? wanted : SEARCH_TYPES).join(','), limit: SEARCH_LIMIT } });
    return unwrap(result, (data) => ({ results: mapSearch(data) }));
  }

  const pageOffset = (offset) => Math.max(0, Math.floor(Number(offset) || 0));
  const pageInfo = (data, offset, count) => {
    const total = Number(data?.total) || 0;
    return { total, offset, nextOffset: data?.next && offset + count < total ? offset + count : null };
  };

  async function playlists(offset = 0) {
    const start = pageOffset(offset);
    const result = await request('GET', '/me/playlists', { query: { limit: PAGE_SIZE, offset: start } });
    return unwrap(result, (data) => {
      const items = (data?.items || []).map(mapPlaylist).filter(Boolean);
      return { items, ...pageInfo(data, start, (data?.items || []).length) };
    });
  }

  async function playlistTracks(id, offset = 0) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(id)) return { ok: false, code: 'INVALID', error: 'Invalid playlist id' };
    const start = pageOffset(offset);
    const result = await request('GET', `/playlists/${id}/items`, { query: { limit: PAGE_SIZE, offset: start } });
    return unwrap(result, (data) => ({ items: mapPlaylistTracks(data), ...pageInfo(data, start, (data?.items || []).length) }));
  }

  /** Home shelves in one call. A shelf whose request fails is left empty; `needsReauth` flags a 403 (token lacks a new scope). */
  async function forYou() {
    const calls = {
      playlists: ['/me/playlists', { limit: PAGE_SIZE }],
      recent: ['/me/player/recently-played', { limit: 30 }],
      topTracks: ['/me/top/tracks', { limit: 20, time_range: 'short_term' }],
      topArtists: ['/me/top/artists', { limit: 20, time_range: 'medium_term' }],
      savedAlbums: ['/me/albums', { limit: 20 }],
      newReleases: ['/browse/new-releases', { limit: 20 }]
    };
    const entries = await Promise.all(Object.entries(calls).map(async ([key, [path, query]]) => [key, await request('GET', path, { query })]));
    const results = Object.fromEntries(entries);
    const auth = entries.find(([, result]) => !result.ok && result.code === 'AUTH');
    if (auth) return auth[1];
    if (entries.every(([, result]) => !result.ok)) return entries[0][1];
    const raw = Object.fromEntries(entries.map(([key, result]) => [key, result.ok ? result.data : null]));
    return { ok: true, ...mapForYou(raw), needsReauth: entries.some(([, result]) => !result.ok && result.status === 403) };
  }

  return { request, me, forYou, getState, devices, transfer, openSpotifyApp, control, setVolume, play, search, playlists, playlistTracks };
}

module.exports = { createClient, planCommand, buildPlayRequest, FRIENDLY, API_BASE, PAGE_SIZE, SEARCH_LIMIT };
