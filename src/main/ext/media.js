'use strict';

const { MediaService } = require('../../../backend/spotify/service');

/**
 * ns `media` (agent M1): Spotify Web API remote control (PKCE). See backend/SPOTIFY.md and the `media` block in backend/contracts.d.ts.
 * Methods: status(), login(), logout(), nowPlaying(), control(command), setVolume(percent), devices(), transfer(deviceId),
 *          search(query, types?), playlists(offset?), playlistTracks(id, offset?), play(request), openSpotifyApp().
 * Events:  `state` (MediaState), `auth` (MediaAuthState).
 * Tokens and the client id stay in the main process; payloads carry only mapped playback data and the auth status.
 */

let service = null;

/** True while a launched application owns the screen: polling stops until the session is idle again. */
function sessionActive() {
  try { return require('./session').controller.phase !== 'idle'; } catch { return false; }
}

const text = (value, max = 256) => (typeof value === 'string' ? value.slice(0, max) : '');
const optionalInt = (value) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);

module.exports = {
  namespace: 'media',
  handlers: {
    status: () => service.status(),
    login: () => service.login(),
    logout: () => service.logout(),
    nowPlaying: () => service.nowPlaying(),
    control: (_ctx, command) => service.control(text(command, 32)),
    setVolume: (_ctx, percent) => service.setVolume(Number(percent)),
    devices: () => service.devices(),
    transfer: (_ctx, deviceId) => service.transfer(text(deviceId, 128)),
    search: (_ctx, query, types) => service.search(text(query, 200), Array.isArray(types) ? types.map((type) => text(type, 16)) : undefined),
    playlists: (_ctx, offset) => service.playlists(optionalInt(offset)),
    playlistTracks: (_ctx, id, offset) => service.playlistTracks(text(id, 64), optionalInt(offset)),
    play: (_ctx, request) => service.play(request && typeof request === 'object' ? request : {}),
    openSpotifyApp: () => service.openSpotifyApp()
  },
  start(ctx) {
    // Electron is required lazily so the module can also be loaded in plain Node tests.
    const { safeStorage, shell } = require('electron');
    service = new MediaService({
      clientId: ctx.secrets.spotifyClientId,
      userData: ctx.userData,
      safeStorage,
      openExternal: (url) => shell.openExternal(url),
      emit: ctx.emit,
      isSuspended: sessionActive,
      isVisible: () => {
        const window = ctx.getWindow();
        return Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized());
      }
    });
    void service.start().catch((error) => console.warn('Media service failed to start:', error.message));
  },
  stop() { service?.stop(); service = null; },
  MediaService
};
