/**
 * Dev-only fake of the `media` extension namespace. Loaded by media-widget.js ONLY when the page URL has
 * `?media-mock[=playing|paused|idle|signed-out|unconfigured|signing-in|error]`. Never active in a normal run.
 * Exposes `window.__mediaMock` for scripted tests: `{ ext, set(partial), calls }`.
 */
(function () {
  'use strict';

  const palette = [['#d6336c', '#4c0f2a'], ['#1c7ed6', '#08254a'], ['#2f9e44', '#0b3016'], ['#f08c00', '#472a00']];
  const art = (index) => {
    const [a, b] = palette[index % palette.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="150" r="70" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="10"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  const tracks = [
    { id: 'm1', uri: 'spotify:track:m1', title: 'Midnight City Lights', artists: ['The Neon Bridge'], album: 'After Hours', artUrl: art(0), durationMs: 214000 },
    { id: 'm2', uri: 'spotify:track:m2', title: 'Blue Hour', artists: ['Kasia Nowak', 'Lumen'], album: 'Glass', artUrl: art(1), durationMs: 187000 },
    { id: 'm3', uri: 'spotify:track:m3', title: 'Evergreen', artists: ['Pine & Moss'], album: 'Roots', artUrl: art(2), durationMs: 242000 },
    { id: 'm4', uri: 'spotify:track:m4', title: 'Golden Ratio', artists: ['Halcyon'], album: 'Proportions', artUrl: art(3), durationMs: 199000 }
  ];

  function create(scenario = 'playing') {
    const listeners = { state: new Set(), auth: new Set() };
    const calls = [];
    let index = 0;
    const signedIn = { status: 'signed-in', displayName: 'Demo', product: 'premium' };
    const state = {
      auth: signedIn, playing: true, track: tracks[0], progressMs: 52000, shuffle: false, repeat: 'off', volume: 40,
      device: { id: 'tv', name: 'Living room', type: 'Computer', active: true, volume: 40 }, idle: false, updatedAt: Date.now()
    };
    const configure = {
      playing: () => {},
      paused: () => { state.playing = false; },
      idle: () => { state.playing = false; state.idle = true; delete state.track; delete state.progressMs; },
      'signed-out': () => { state.auth = { status: 'signed-out' }; state.playing = false; state.idle = true; delete state.track; },
      unconfigured: () => { state.auth = { status: 'unconfigured' }; state.playing = false; state.idle = true; delete state.track; },
      'signing-in': () => { state.auth = { status: 'signing-in', url: 'https://accounts.spotify.com/authorize?client_id=demo' }; state.playing = false; state.idle = true; delete state.track; },
      error: () => { state.auth = { status: 'error', message: 'fetch failed ECONNREFUSED' }; state.playing = false; state.idle = true; delete state.track; }
    };
    (configure[scenario] || configure.playing)();

    // Playback clock: the real backend reports a position; the mock advances it between pushes.
    let clock = Date.now();
    const snapshot = () => {
      const now = Date.now();
      if (state.playing && state.track) state.progressMs = Math.min(state.track.durationMs, (state.progressMs || 0) + (now - clock));
      clock = now;
      state.updatedAt = now;
      return JSON.parse(JSON.stringify(state));
    };
    const push = () => { const value = snapshot(); for (const callback of listeners.state) callback(value); };
    const pushAuth = () => { for (const callback of listeners.auth) callback({ ...state.auth }); };

    const methods = {
      nowPlaying: () => snapshot(),
      status: () => snapshot(),
      login: () => {
        state.auth = { status: 'signing-in', url: 'https://accounts.spotify.com/authorize?client_id=demo' };
        pushAuth(); push();
        setTimeout(() => { state.auth = signedIn; Object.assign(state, { idle: false, playing: true, track: tracks[0], progressMs: 0 }); push(); pushAuth(); }, 5000);
        return { ok: true, url: state.auth.url };
      },
      logout: () => { configure['signed-out'](); pushAuth(); push(); },
      openSpotifyApp: () => { setTimeout(() => { Object.assign(state, { idle: false, playing: true, track: tracks[index % tracks.length], progressMs: 0 }); push(); }, 800); return { ok: true }; },
      control: (command) => {
        snapshot();
        switch (command) {
          case 'play': state.playing = Boolean(state.track); break;
          case 'pause': state.playing = false; break;
          case 'toggle': state.playing = state.track ? !state.playing : false; break;
          case 'next': case 'previous':
            index = (index + (command === 'next' ? 1 : tracks.length - 1)) % tracks.length;
            Object.assign(state, { track: tracks[index], progressMs: 0, playing: true, idle: false });
            break;
          case 'shuffle': state.shuffle = !state.shuffle; break;
          case 'repeat': state.repeat = { off: 'context', context: 'track', track: 'off' }[state.repeat]; break;
          case 'volume-up': state.volume = Math.min(100, state.volume + 10); break;
          case 'volume-down': state.volume = Math.max(0, state.volume - 10); break;
          default: throw new Error(`Unknown command ${command}`);
        }
        push();
        return { ok: true };
      }
    };

    const ext = {
      invoke: async (namespace, method, ...args) => {
        if (namespace !== 'media') throw new Error(`No mock for ${namespace}`);
        calls.push([method, ...args]);
        if (!methods[method]) throw new Error(`No mock for media.${method}`);
        return methods[method](...args);
      },
      on: (namespace, event, callback) => {
        if (namespace !== 'media' || !listeners[event]) return () => {};
        listeners[event].add(callback);
        return () => listeners[event].delete(callback);
      }
    };

    return {
      ext, calls,
      /** Merges fields into the mock state and pushes it (scripted tests). */
      set(partial) { Object.assign(state, partial); push(); pushAuth(); }
    };
  }

  window.MediaMock = { create };
})();
