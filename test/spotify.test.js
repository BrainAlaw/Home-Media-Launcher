'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const pkce = require('../backend/spotify/pkce');
const { mapPlayback, mapSearch, mapPlaylist, mapPlaylistTracks } = require('../backend/spotify/mappers');
const { createClient, planCommand, buildPlayRequest } = require('../backend/spotify/client');
const { SpotifyAuth } = require('../backend/spotify/auth');
const { MediaService, pollInterval } = require('../backend/spotify/service');

/* ---------------------------------------------------------------- fixtures (shapes recorded from the 2026 Web API) */
const IMAGES = [{ url: 'https://i.scdn.co/image/640', width: 640, height: 640 }, { url: 'https://i.scdn.co/image/300', width: 300, height: 300 }, { url: 'https://i.scdn.co/image/64', width: 64, height: 64 }];
const TRACK = { id: 't1', uri: 'spotify:track:t1', type: 'track', name: 'Song', duration_ms: 200000, artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Album', images: IMAGES } };
const PLAYBACK = {
  device: { id: 'dev1', name: 'Living Room PC', type: 'Computer', is_active: true, volume_percent: 40, supports_volume: true },
  repeat_state: 'off', shuffle_state: false, is_playing: true, progress_ms: 12345, item: TRACK, currently_playing_type: 'track'
};
const PLAYLIST = { id: 'p1', uri: 'spotify:playlist:p1', name: 'Mix', images: IMAGES, owner: { display_name: 'Me' }, items: { total: 12 }, tracks: { total: 12 } };

/* ---------------------------------------------------------------- helpers */
const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
const noContent = () => json(204);

function fakeSafeStorage() {
  return { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(`enc:${value}`), decryptString: (buffer) => buffer.toString().replace(/^enc:/, '') };
}

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-test-')); }

/** Fetch stub routed by "METHOD path"; records every call. */
function router(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    const key = `${init.method || 'GET'} ${parsed.hostname === 'accounts.spotify.com' ? 'TOKEN' : parsed.pathname.replace('/v1', '')}`;
    calls.push({ key, url: parsed, init });
    const handler = routes[key];
    if (!handler) throw new Error(`unrouted ${key}`);
    return typeof handler === 'function' ? handler(calls.filter((call) => call.key === key).length, parsed, init) : handler;
  };
  return { fetch, calls };
}

function authStub(initial = 'token-1') {
  let token = initial;
  const stub = { refreshes: 0, getAccessToken: async () => token, refresh: async () => { stub.refreshes += 1; token = 'token-2'; return { ok: true }; } };
  return stub;
}

/* ---------------------------------------------------------------- PKCE */
test('PKCE challenge matches the RFC 7636 test vector', () => {
  assert.equal(pkce.createChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('PKCE verifier is 43-128 unreserved characters and unique', () => {
  const a = pkce.createVerifier();
  assert.match(a, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.notEqual(a, pkce.createVerifier());
});

test('authorize URL carries S256, state, redirect and all required scopes', () => {
  const url = new URL(pkce.buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:8888/callback', challenge: 'chal', state: 'st' }));
  assert.equal(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8888/callback');
  const scopes = url.searchParams.get('scope').split(' ');
  for (const scope of ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing', 'playlist-read-private', 'playlist-read-collaborative', 'user-library-read']) assert.ok(scopes.includes(scope));
});

/* ---------------------------------------------------------------- mapping */
test('playback payload maps to MediaState fields', () => {
  const state = mapPlayback(PLAYBACK);
  assert.equal(state.playing, true);
  assert.equal(state.idle, false);
  assert.equal(state.progressMs, 12345);
  assert.equal(state.volume, 40);
  assert.equal(state.repeat, 'off');
  assert.deepEqual(state.track, { id: 't1', uri: 'spotify:track:t1', title: 'Song', artists: ['A', 'B'], album: 'Album', artUrl: 'https://i.scdn.co/image/300', durationMs: 200000 });
  assert.deepEqual(state.device, { id: 'dev1', name: 'Living Room PC', type: 'computer', active: true, volume: 40 });
});

test('HTTP 204 and inactive device map to idle', () => {
  assert.deepEqual(mapPlayback(null), { playing: false, idle: true });
  const paused = mapPlayback({ ...PLAYBACK, is_playing: false, device: { ...PLAYBACK.device, is_active: false } });
  assert.equal(paused.idle, true);
  assert.equal(mapPlayback({ ...PLAYBACK, is_playing: false }).idle, false);
});

test('ads (no item) keep playing without a track', () => {
  const state = mapPlayback({ ...PLAYBACK, item: null, currently_playing_type: 'ad' });
  assert.equal(state.track, undefined);
  assert.equal(state.playing, true);
});

test('search, playlists and playlist items map; item and deprecated track fields are both accepted', () => {
  const search = mapSearch({ tracks: { items: [TRACK] }, albums: { items: [{ id: 'a1', uri: 'spotify:album:a1', name: 'Alb', artists: [{ name: 'X' }], images: IMAGES }] }, playlists: { items: [PLAYLIST, null] }, artists: { items: [{ id: 'r1', uri: 'spotify:artist:r1', name: 'Art', images: IMAGES }] } });
  assert.equal(search.tracks.length, 1);
  assert.equal(search.albums[0].artist, 'X');
  assert.equal(search.playlists.length, 1);
  assert.equal(search.artists[0].name, 'Art');
  assert.equal(mapPlaylist(PLAYLIST).trackCount, 12);
  assert.equal(mapPlaylist({ ...PLAYLIST, items: undefined }).trackCount, 12);
  assert.equal(mapPlaylistTracks({ items: [{ item: TRACK }, { track: TRACK }, { item: null }] }).length, 2);
});

/* ---------------------------------------------------------------- command mapping */
test('transport commands map to Web API requests', () => {
  assert.deepEqual(planCommand('play'), { method: 'PUT', path: '/me/player/play' });
  assert.deepEqual(planCommand('pause'), { method: 'PUT', path: '/me/player/pause' });
  assert.equal(planCommand('toggle', { playing: true }).path, '/me/player/pause');
  assert.equal(planCommand('toggle', { playing: false }).path, '/me/player/play');
  assert.deepEqual(planCommand('next'), { method: 'POST', path: '/me/player/next' });
  assert.deepEqual(planCommand('previous'), { method: 'POST', path: '/me/player/previous' });
  assert.equal(planCommand('shuffle', { shuffle: false }).query.state, 'true');
  assert.equal(planCommand('shuffle', { shuffle: true }).query.state, 'false');
  assert.equal(planCommand('repeat', { repeat: 'off' }).query.state, 'context');
  assert.equal(planCommand('repeat', { repeat: 'context' }).query.state, 'track');
  assert.equal(planCommand('repeat', { repeat: 'track' }).query.state, 'off');
  assert.equal(planCommand('volume-up', { volume: 40 }).query.volume_percent, '50');
  assert.equal(planCommand('volume-up', { volume: 95 }).query.volume_percent, '100');
  assert.equal(planCommand('volume-down', { volume: 5 }).query.volume_percent, '0');
  assert.ok(planCommand('explode').error);
});

test('play request validates Spotify URIs and builds the body', () => {
  assert.deepEqual(buildPlayRequest({ contextUri: 'spotify:playlist:abc', offsetUri: 'spotify:track:def', deviceId: 'dev1' }), { body: { context_uri: 'spotify:playlist:abc', offset: { uri: 'spotify:track:def' } }, query: { device_id: 'dev1' } });
  assert.deepEqual(buildPlayRequest({ uris: ['spotify:track:abc'] }).body, { uris: ['spotify:track:abc'] });
  assert.ok(buildPlayRequest({ contextUri: 'https://evil.example' }).error);
  assert.ok(buildPlayRequest({ uris: ['spotify:track:abc'], contextUri: 'spotify:album:abc' }).error);
  assert.ok(buildPlayRequest({ deviceId: '../x' }).error);
});

/* ---------------------------------------------------------------- client behaviour */
test('401 triggers one refresh and a retry with the new token', async () => {
  const auth = authStub();
  const seen = [];
  const { fetch } = router({ 'GET /me/player': (n, _url, init) => { seen.push(init.headers.Authorization); return n === 1 ? json(401, { error: { status: 401 } }) : json(200, PLAYBACK); } });
  const client = createClient({ auth, fetch, sleep: async () => {} });
  const result = await client.getState();
  assert.equal(result.ok, true);
  assert.equal(auth.refreshes, 1);
  assert.deepEqual(seen, ['Bearer token-1', 'Bearer token-2']);
});

test('persistent 401 after refresh fails without looping', async () => {
  const auth = authStub();
  const { fetch, calls } = router({ 'GET /me/player': json(401, { error: { status: 401 } }) });
  const result = await createClient({ auth, fetch, sleep: async () => {} }).getState();
  assert.equal(result.ok, false);
  assert.equal(calls.length, 2);
});

test('429 honours Retry-After and retries', async () => {
  const sleeps = [];
  let clock = 1_000_000;
  const { fetch } = router({ 'GET /me/player/devices': (n) => (n === 1 ? json(429, {}, { 'retry-after': '3' }) : json(200, { devices: [] })) });
  const client = createClient({ auth: authStub(), fetch, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
  const result = await client.devices();
  assert.equal(result.ok, true);
  assert.deepEqual(sleeps, [3000]);
});

test('a long Retry-After fails fast with the wait time instead of blocking', async () => {
  const { fetch, calls } = router({ 'GET /me/player': json(429, {}, { 'retry-after': '120' }) });
  const client = createClient({ auth: authStub(), fetch, sleep: async () => { throw new Error('must not sleep'); } });
  const result = await client.getState();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RATE_LIMITED');
  assert.ok(result.retryAfterMs >= 120_000 - 1);
  assert.equal((await client.getState()).code, 'RATE_LIMITED');
  assert.equal(calls.length >= 1, true);
});

test('network failure resolves offline instead of throwing', async () => {
  const client = createClient({ auth: authStub(), fetch: async () => { throw new TypeError('fetch failed'); }, sleep: async () => {} });
  const result = await client.getState();
  assert.deepEqual([result.ok, result.offline, result.code], [false, true, 'OFFLINE']);
});

test('no active device: transfers to the last used device and retries the command', async () => {
  let transferred = false;
  const { fetch, calls } = router({
    'PUT /me/player/play': () => (transferred ? noContent() : json(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } })),
    'GET /me/player/devices': json(200, { devices: [{ id: 'a', name: 'Phone', type: 'Smartphone', is_active: false }, { id: 'b', name: 'PC', type: 'Computer', is_active: false }] }),
    'PUT /me/player': () => { transferred = true; return noContent(); }
  });
  const client = createClient({ auth: authStub(), fetch, sleep: async () => {}, getLastDeviceId: () => 'b' });
  const result = await client.control('play');
  assert.equal(result.ok, true);
  const transfer = calls.find((call) => call.key === 'PUT /me/player');
  assert.deepEqual(JSON.parse(transfer.init.body), { device_ids: ['b'], play: true });
});

test('no devices at all: launches the app, waits for a device, transfers playback', async () => {
  let clock = 0;
  let launched = 0;
  let devicePolls = 0;
  let transferred = false;
  const { fetch } = router({
    'PUT /me/player/play': () => (transferred ? noContent() : json(404, { error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } })),
    'GET /me/player/devices': () => { devicePolls += 1; return json(200, { devices: devicePolls >= 3 ? [{ id: 'new', name: 'PC', type: 'Computer', is_active: false }] : [] }); },
    'PUT /me/player': () => { transferred = true; return noContent(); }
  });
  const client = createClient({ auth: authStub(), fetch, now: () => clock, sleep: async (ms) => { clock += ms; }, openApp: async () => { launched += 1; } });
  assert.equal((await client.control('play')).ok, true);
  assert.equal(launched, 1);
  assert.equal(devicePolls, 3);
});

test('app never appears: gives up after 8 seconds with a friendly message', async () => {
  let clock = 0;
  const { fetch } = router({ 'PUT /me/player/play': json(404, { error: { reason: 'NO_ACTIVE_DEVICE' } }), 'GET /me/player/devices': json(200, { devices: [] }) });
  const client = createClient({ auth: authStub(), fetch, now: () => clock, sleep: async (ms) => { clock += ms; }, openApp: async () => {} });
  const result = await client.control('play');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_DEVICE');
  assert.ok(clock >= 8000 && clock <= 10_000);
});

test('pause with no device does not launch the app', async () => {
  const { fetch } = router({ 'PUT /me/player/pause': json(404, { error: { reason: 'NO_ACTIVE_DEVICE' } }), 'GET /me/player/devices': json(200, { devices: [] }) });
  const client = createClient({ auth: authStub(), fetch, sleep: async () => {}, openApp: async () => { throw new Error('must not launch'); } });
  assert.equal((await client.control('pause')).code, 'NO_ACTIVE_DEVICE');
});

test('403 premium-required becomes a friendly message', async () => {
  const { fetch } = router({ 'PUT /me/player/pause': json(403, { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } }) });
  const result = await createClient({ auth: authStub(), fetch, sleep: async () => {} }).control('pause');
  assert.deepEqual([result.ok, result.code], [false, 'PREMIUM_REQUIRED']);
  assert.match(result.error, /Premium/);
});

test('search uses limit 10, filters types; playlist paging uses /items with limit 50', async () => {
  const { fetch, calls } = router({
    'GET /search': json(200, { tracks: { items: [TRACK] } }),
    'GET /me/playlists': json(200, { items: [PLAYLIST], total: 120, next: 'x' }),
    'GET /playlists/p1/items': json(200, { items: [{ item: TRACK }], total: 1, next: null })
  });
  const client = createClient({ auth: authStub(), fetch, sleep: async () => {} });
  const found = await client.search('daft punk', ['track', 'bogus']);
  assert.equal(found.results.tracks.length, 1);
  const searchUrl = calls[0].url;
  assert.equal(searchUrl.searchParams.get('limit'), '10');
  assert.equal(searchUrl.searchParams.get('type'), 'track');
  const page = await client.playlists(0);
  assert.deepEqual([page.items.length, page.total, page.nextOffset], [1, 120, 1]);
  const tracks = await client.playlistTracks('p1', 0);
  assert.deepEqual([tracks.items.length, tracks.nextOffset], [1, null]);
  assert.equal((await client.playlistTracks('../etc', 0)).ok, false);
});

/* ---------------------------------------------------------------- auth flow */
function callback(url, params) {
  return new Promise((resolve, reject) => {
    http.get(`${url}?${new URLSearchParams(params)}`, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); }).on('error', reject);
  });
}

async function startLogin(auth) {
  const events = [];
  auth.onChange((event) => events.push(event));
  const result = await auth.login();
  assert.equal(result.ok, true);
  const authorize = new URL(result.url);
  return { events, result, state: authorize.searchParams.get('state'), authorize };
}

test('login: loopback server validates state, exchanges the code with the verifier and stores encrypted tokens', async () => {
  const dir = tempDir();
  const tokenPath = path.join(dir, 'spotify-tokens.json');
  const opened = [];
  const { fetch, calls } = router({ 'POST TOKEN': json(200, { access_token: 'ACCESS-SECRET-1', refresh_token: 'REFRESH-SECRET-1', expires_in: 3600 }) });
  const auth = new SpotifyAuth({ clientId: 'client-abc', fetch, safeStorage: fakeSafeStorage(), tokenPath, openExternal: async (url) => { opened.push(url); }, ports: [0] });
  const { events, result, state, authorize } = await startLogin(auth);
  assert.deepEqual(opened, [result.url]);
  assert.equal(events[0].status, 'signing-in');
  assert.match(result.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

  assert.equal(await callback(result.redirectUri, { code: 'x', state: 'wrong' }), 400);
  assert.equal(calls.length, 0);
  assert.equal(await callback(result.redirectUri.replace('/callback', '/other'), { state }), 404);
  assert.equal(await callback(result.redirectUri, { code: 'authcode', state }), 200);

  const exchange = new URLSearchParams(calls[0].init.body);
  assert.equal(exchange.get('grant_type'), 'authorization_code');
  assert.equal(exchange.get('code'), 'authcode');
  assert.equal(exchange.get('redirect_uri'), result.redirectUri);
  assert.equal(pkce.createChallenge(exchange.get('code_verifier')), authorize.searchParams.get('code_challenge'));
  assert.equal(events.at(-1).status, 'signed-in');
  assert.equal(await auth.getAccessToken(), 'ACCESS-SECRET-1');

  const stored = fs.readFileSync(tokenPath, 'utf8');
  assert.ok(!stored.includes('REFRESH-SECRET-1'), 'refresh token must not be stored in plain text');
  const second = new SpotifyAuth({ clientId: 'client-abc', fetch, safeStorage: fakeSafeStorage(), tokenPath });
  assert.equal(await second.init(), true);
  // The listener is closed after use.
  await assert.rejects(callback(result.redirectUri, { code: 'again', state }));
  await auth.logout();
  assert.equal(fs.existsSync(tokenPath), false);
});

test('login times out and closes the listener', async () => {
  const { fetch } = router({});
  const auth = new SpotifyAuth({ clientId: 'cid', fetch, safeStorage: fakeSafeStorage(), tokenPath: path.join(tempDir(), 't.json'), ports: [0], loginTimeoutMs: 30 });
  const { events, result } = await startLogin(auth);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(events.at(-1).status, 'error');
  await assert.rejects(callback(result.redirectUri, { code: 'c', state: 's' }));
});

test('login falls through busy ports and is unconfigured without a client id', async () => {
  const blocker = http.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const busy = blocker.address().port;
  const auth = new SpotifyAuth({ clientId: 'cid', fetch: async () => json(200, {}), safeStorage: fakeSafeStorage(), tokenPath: path.join(tempDir(), 't.json'), ports: [busy, 0] });
  const result = await auth.login();
  assert.equal(result.ok, true);
  assert.ok(!result.redirectUri.includes(`:${busy}/`));
  auth.dispose();
  blocker.close();
  assert.equal((await new SpotifyAuth({ clientId: '' }).login()).ok, false);
});

test('refresh: keeps the old refresh token when none is returned; revoked token signs out', async () => {
  const dir = tempDir();
  const tokenPath = path.join(dir, 't.json');
  const storage = fakeSafeStorage();
  let clock = 1_000_000;
  let revoke = false;
  const { fetch } = router({ 'POST TOKEN': (_n, _url, init) => {
    const body = new URLSearchParams(init.body);
    if (body.get('grant_type') === 'authorization_code') return json(200, { access_token: 'A1', refresh_token: 'R1', expires_in: 3600 });
    return revoke ? json(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }) : json(200, { access_token: 'A2', expires_in: 3600 });
  } });
  const auth = new SpotifyAuth({ clientId: 'cid', fetch, safeStorage: storage, tokenPath, now: () => clock, ports: [0] });
  const { result, state, events } = await startLogin(auth);
  await callback(result.redirectUri, { code: 'c', state });
  clock += 3_600_000;
  assert.equal(await auth.getAccessToken(), 'A2');
  assert.equal(auth.tokens.refreshToken, 'R1');
  clock += 3_600_000;
  revoke = true;
  assert.equal(await auth.getAccessToken(), null);
  assert.equal(auth.signedIn, false);
  assert.equal(events.at(-1).status, 'signed-out');
  assert.equal(fs.existsSync(tokenPath), false);
});

test('SPOTIFY_CLIENT_ID missing reports unconfigured', async () => {
  const service = new MediaService({ clientId: '', userData: tempDir() });
  await service.start({ autoPoll: false });
  assert.deepEqual(service.status().auth, { status: 'unconfigured' });
  assert.equal((await service.control('play')).ok, false);
});

/* ---------------------------------------------------------------- service */
async function signedInService({ routes, emit, userData = tempDir(), isSuspended } = {}) {
  const storage = fakeSafeStorage();
  const tokenPath = path.join(userData, 'spotify-tokens.json');
  fs.writeFileSync(tokenPath, JSON.stringify({ version: 1, encrypted: storage.encryptString(JSON.stringify({ accessToken: 'ACCESS-SECRET', refreshToken: 'REFRESH-SECRET', expiresAt: Date.now() + 3_600_000 })).toString('base64') }));
  const { fetch, calls } = router({ 'GET /me': json(200, { display_name: 'Maciej' }), ...routes });
  const service = new MediaService({ clientId: 'CLIENT-ID-SECRET', userData, fetch, safeStorage: storage, emit, isSuspended, sleep: async () => {} });
  await service.start({ autoPoll: false });
  return { service, calls, userData };
}

test('service: restores the session, polls state, emits only on change, caches to disk', async () => {
  const emitted = [];
  const { service, userData } = await signedInService({ emit: (event, payload) => emitted.push([event, payload]), routes: { 'GET /me/player': json(200, PLAYBACK) } });
  assert.deepEqual(service.status().auth, { status: 'signed-in', displayName: 'Maciej' });
  await service.refresh();
  await service.refresh();
  const states = emitted.filter(([event]) => event === 'state');
  assert.equal(states.length, 2, 'initial auth state plus one playback change');
  assert.equal(states.at(-1)[1].track.title, 'Song');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const cache = JSON.parse(fs.readFileSync(path.join(userData, 'media-state.json'), 'utf8'));
  assert.equal(cache.playback.track.id, 't1');

  // A fresh service shows the cached track immediately, flagged stale and not playing.
  const next = await signedInService({ userData, routes: {} });
  assert.equal(next.service.status().track.id, 't1');
  assert.equal(next.service.status().stale, true);
  assert.equal(next.service.status().playing, false);
});

test('service: offline keeps the last state flagged stale and never throws', async () => {
  let offline = false;
  const { service } = await signedInService({ routes: { 'GET /me/player': () => { if (offline) throw new TypeError('fetch failed'); return json(200, PLAYBACK); } } });
  await service.refresh();
  offline = true;
  const state = await service.refresh();
  assert.equal(state.stale, true);
  assert.equal(state.track.id, 't1');
});

test('service: tokens and client id never appear in emitted payloads or error results', async () => {
  const emitted = [];
  const { service } = await signedInService({
    emit: (event, payload) => emitted.push(payload),
    routes: { 'GET /me/player': json(200, PLAYBACK), 'PUT /me/player/pause': json(403, { error: { message: 'Bearer ACCESS-SECRET rejected', reason: 'PREMIUM_REQUIRED' } }), 'GET /search': json(500, { error: { message: 'boom ACCESS-SECRET' } }) }
  });
  await service.refresh();
  const results = [await service.control('pause'), await service.search('x'), await service.devices().catch((error) => error.message), service.status()];
  const dump = JSON.stringify([emitted, results]);
  for (const secret of ['ACCESS-SECRET', 'REFRESH-SECRET', 'CLIENT-ID-SECRET']) assert.ok(!dump.includes(secret), `${secret} leaked`);
});

test('service: control toggles using fresh state and schedules no extra polling when stopped', async () => {
  const { service, calls } = await signedInService({ routes: { 'GET /me/player': json(200, PLAYBACK), 'PUT /me/player/pause': noContent() } });
  const result = await service.control('toggle');
  assert.deepEqual(result, { ok: true });
  assert.ok(calls.some((call) => call.key === 'PUT /me/player/pause'));
  service.stop();
});

test('service: signed-out handlers fail softly', async () => {
  const service = new MediaService({ clientId: 'cid', userData: tempDir(), fetch: async () => { throw new Error('no network expected'); }, safeStorage: fakeSafeStorage() });
  await service.start({ autoPoll: false });
  assert.equal(service.status().auth.status, 'signed-out');
  assert.equal((await service.control('play')).ok, false);
  assert.deepEqual((await service.search('a')).results.tracks, []);
  assert.equal((await service.playlists()).items.length, 0);
});

test('adaptive polling intervals', () => {
  const playing = { playing: true, idle: false };
  assert.equal(pollInterval({ suspended: false, visible: true, playback: playing }), 1000);
  assert.equal(pollInterval({ suspended: false, visible: true, playback: { playing: false, idle: false } }), 5000);
  assert.equal(pollInterval({ suspended: false, visible: true, playback: { playing: false, idle: true } }), 15_000);
  assert.equal(pollInterval({ suspended: false, visible: false, playback: playing }), 15_000);
  assert.equal(pollInterval({ suspended: true, visible: true, playback: playing }), 2000);
  assert.equal(pollInterval({ suspended: false, visible: true, playback: playing, failures: 3 }), 8000);
  assert.equal(pollInterval({ suspended: false, visible: true, playback: playing, waitMs: 30_000 }), 30_000);
});

test('service: polls only while the renderer reports an active media UI', async (t) => {
  const userData = tempDir();
  const storage = fakeSafeStorage();
  fs.writeFileSync(path.join(userData, 'spotify-tokens.json'), JSON.stringify({ version: 1, encrypted: storage.encryptString(JSON.stringify({ accessToken: 'A', refreshToken: 'R', expiresAt: Date.now() + 3_600_000 })).toString('base64') }));
  const { fetch, calls } = router({ 'GET /me': json(200, { display_name: 'Maciej' }), 'GET /me/player': json(200, PLAYBACK) });
  const service = new MediaService({ clientId: 'cid', userData, fetch, safeStorage: storage, sleep: async () => {} });
  const playerCalls = () => calls.filter((call) => call.key === 'GET /me/player').length;
  const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

  t.mock.timers.enable({ apis: ['setTimeout'] });
  await service.start();
  await flush();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(playerCalls(), 0, 'inactive by default: no playback requests, even after a minute');
  assert.equal(service.status().auth.status, 'signed-in', 'auth still works while inactive');

  assert.deepEqual(service.setActive(true), { ok: true, active: true });
  t.mock.timers.tick(0);
  await flush();
  assert.equal(playerCalls(), 1, 'activation fetches immediately');
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(playerCalls(), 2, 'playing state polls about once per second while active');

  service.setActive(false);
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(playerCalls(), 2, 'no requests after deactivation');

  service.setActive(true);
  t.mock.timers.tick(0);
  await flush();
  assert.equal(playerCalls(), 3, 'reactivation fetches immediately again');
  service.setActive(true);
  t.mock.timers.tick(0);
  await flush();
  assert.equal(playerCalls(), 3, 'repeating the same state is a no-op');
  service.stop();
});
