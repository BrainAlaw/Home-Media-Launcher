(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MediaMock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Offline stand-in for the `media` ext namespace (dev only, enabled with `?media-mock[=scenario]`).
   * Mirrors the contract in backend/contracts.d.ts. Scenarios: ready (default), signed-out, unconfigured, premium, rate-limit, private-playlist.
   * Return shapes match ns `media` (`{ ok, ... }` envelopes, `nextOffset: null` ends a page chain).
   * Art is generated as inline SVG so no network access is needed.
   */

  const PLAYLIST_TOTAL = 137;
  const PAGE_SIZE = 50;
  const DETAIL_TRACKS = 140;
  const LATENCY_MS = 90;

  const ARTISTS = ['Aurora Vale', 'The Night Owls', 'Mira Solenne', 'Kite & Compass', 'Neon Harbour', 'Lowlight Choir', 'Paper Satellites', 'Dune Radio'];
  const WORDS = ['Glass', 'Ember', 'Harbour', 'Static', 'Velvet', 'Orbit', 'Lantern', 'Tidal', 'Echo', 'Meridian', 'Hollow', 'Signal'];

  function art(seed) {
    const hue = (seed * 47) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},62%,46%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},58%,20%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="${90 + (seed * 37) % 120}" cy="${100 + (seed * 53) % 100}" r="${50 + (seed * 11) % 40}" fill="hsla(${(hue + 180) % 360},70%,70%,.28)"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  const track = (n) => ({
    id: `t${n}`,
    uri: `spotify:track:t${n}`,
    title: `${WORDS[n % WORDS.length]} ${WORDS[(n * 5 + 3) % WORDS.length]}`,
    artists: [ARTISTS[n % ARTISTS.length]],
    album: `${WORDS[(n * 3) % WORDS.length]} Hours`,
    artUrl: art(n),
    durationMs: 150000 + ((n * 7919) % 120000)
  });
  const playlist = (n) => ({ id: `p${n}`, uri: `spotify:playlist:p${n}`, name: `${WORDS[n % WORDS.length]} ${['Mix', 'Sessions', 'Radio', 'Favourites'][n % 4]} ${n + 1}`, trackCount: 20 + ((n * 13) % 180), artUrl: art(n + 100), owner: n % 3 ? 'You' : 'Spotify' });
  const album = (n) => ({ id: `a${n}`, uri: `spotify:album:a${n}`, name: `${WORDS[(n * 2) % WORDS.length]} ${WORDS[(n + 7) % WORDS.length]}`, artist: ARTISTS[n % ARTISTS.length], artUrl: art(n + 200) });
  const artist = (n) => ({ id: `r${n}`, uri: `spotify:artist:r${n}`, name: ARTISTS[n % ARTISTS.length], artUrl: art(n + 300) });
  const range = (count, make) => Array.from({ length: count }, (_, i) => make(i));

  const DEVICES = [
    { id: 'd1', name: 'Living Room TV', type: 'TV', active: true, volume: 40 },
    { id: 'd2', name: 'Studio Speaker', type: 'Speaker', active: false, volume: 55 },
    { id: 'd3', name: 'Maciej’s Phone', type: 'Smartphone', active: false }
  ];

  /**
   * @param {{ scenario?: string, latency?: number }} [options]
   * @returns {{ invoke: (method: string, ...args: any[]) => Promise<any>, on: (event: string, cb: (payload: any) => void) => () => void, calls: any[] }}
   */
  function createMockBridge({ scenario = 'ready', latency = LATENCY_MS } = {}) {
    const listeners = new Set();
    const calls = [];
    const devices = DEVICES.map((device) => ({ ...device }));
    let auth = scenario === 'signed-out' ? { status: 'signed-out' } : scenario === 'unconfigured' ? { status: 'unconfigured' } : { status: 'signed-in', displayName: 'Maciej', product: scenario === 'premium' ? 'free' : 'premium' };
    let state = {
      auth, playing: true, track: track(3), progressMs: 61000, shuffle: false, repeat: 'off', volume: 40,
      device: devices[0], idle: false, updatedAt: Date.now()
    };
    if (auth.status !== 'signed-in') state = { auth, playing: false, idle: true, updatedAt: Date.now() };

    const emit = () => { state = { ...state, auth, updatedAt: Date.now() }; for (const cb of listeners) cb(state); };
    const delay = (value) => new Promise((resolve) => setTimeout(() => resolve(value), latency));
    const fail = (error, code) => delay({ ok: false, error, code });

    const pageOf = (offset, total, make) => {
      const count = Math.max(0, Math.min(PAGE_SIZE, total - offset));
      const next = offset + count;
      return delay({ ok: true, items: range(count, (i) => make(offset + i)), total, offset, nextOffset: next < total ? next : null });
    };

    const handlers = {
      status: () => delay(state),
      nowPlaying: () => delay(state),
      login: () => { auth = { status: 'signed-in', displayName: 'Maciej' }; emit(); return delay({ ok: true }); },
      logout: () => { auth = { status: 'signed-out' }; emit(); return delay({ ok: true }); },
      control: (command) => {
        if (scenario === 'premium') return fail('Spotify Premium required', 'PREMIUM_REQUIRED');
        if (command === 'toggle') state = { ...state, playing: !state.playing };
        else if (command === 'play') state = { ...state, playing: true };
        else if (command === 'pause') state = { ...state, playing: false };
        else if (command === 'next') state = { ...state, track: track((Number(state.track?.id.slice(1)) || 0) + 1), progressMs: 0 };
        else if (command === 'previous') state = { ...state, track: track(Math.max(0, (Number(state.track?.id.slice(1)) || 1) - 1)), progressMs: 0 };
        emit();
        return delay({ ok: true });
      },
      setVolume: (percent) => { state = { ...state, volume: percent }; emit(); return delay({ ok: true }); },
      devices: () => delay({ ok: true, devices: devices.map((device) => ({ ...device })) }),
      transfer: (deviceId) => {
        devices.forEach((device) => { device.active = device.id === deviceId; });
        state = { ...state, device: devices.find((device) => device.id === deviceId), idle: false };
        emit();
        return delay({ ok: true });
      },
      search: (query, types) => {
        if (scenario === 'rate-limit') return fail('Rate limited', 'RATE_LIMITED');
        const q = String(query || '').trim();
        if (!q) return delay({ ok: true, results: { tracks: [], albums: [], playlists: [], artists: [] } });
        const wants = (type) => !types || types.includes(type);
        return delay({ ok: true, results: {
          tracks: wants('track') ? range(10, (i) => ({ ...track(i + q.length), title: `${q} · ${track(i + q.length).title}` })) : [],
          albums: wants('album') ? range(10, album) : [],
          playlists: wants('playlist') ? range(9, playlist) : [],
          artists: wants('artist') ? range(8, artist) : []
        } });
      },
      playlists: (offset = 0) => pageOf(offset, PLAYLIST_TOTAL, playlist),
      playlistTracks: (id, offset = 0) => (scenario === 'private-playlist' ? fail('Forbidden', 'HTTP_403') : pageOf(offset, DETAIL_TRACKS, (i) => track(i + 10))),
      play: (request) => {
        if (scenario === 'premium') return fail('Spotify Premium required', 'PREMIUM_REQUIRED');
        const uri = request?.offsetUri || request?.uris?.[0];
        const n = uri ? Number(uri.split(':').pop().replace(/\D/g, '')) : 10;
        state = { ...state, playing: true, track: track(Number.isFinite(n) ? n : 10), progressMs: 0, idle: false };
        emit();
        return delay({ ok: true });
      },
      openSpotifyApp: () => delay({ ok: true })
    };

    return {
      calls,
      invoke(method, ...args) {
        calls.push({ method, args });
        const handler = handlers[method];
        return handler ? Promise.resolve(handler(...args)) : Promise.reject(new Error(`mock: unknown method ${method}`));
      },
      on(event, callback) {
        if (event === 'state') { listeners.add(callback); return () => listeners.delete(callback); }
        return () => {};
      }
    };
  }

  return { createMockBridge, PLAYLIST_TOTAL, DETAIL_TRACKS, PAGE_SIZE };
});
