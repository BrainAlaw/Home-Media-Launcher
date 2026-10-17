(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MediaControls = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Pure (DOM-free) logic for the home-screen "now playing" widget: state normalisation, the state -> view model
   * mapping, local progress interpolation, optimistic command effects, the widget-internal focus model and the
   * global media key mapping. Everything here is unit-tested; media-widget.js only renders and wires events.
   *
   * Backend contract: ns `media` (backend/contracts.d.ts). The contract has no seek method, so there is no seeking.
   */

  const VOLUME_STEP = 10;
  const MAX_VOLUME = 100;
  const REPEAT_CYCLE = Object.freeze({ off: 'context', context: 'track', track: 'off' });

  /** @typedef {'prev'|'toggle'|'next'|'shuffle'|'repeat'|'volume-down'|'volume-up'|'library'|'open-spotify'|'login'|'retry'} ActionId */

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /**
   * Accepts a MediaState, a bare MediaAuthState (`{ status }`) or nothing, and always returns a MediaState-shaped object.
   * @param {any} raw
   * @param {number} [receivedAt] local timestamp of reception, anchors progress interpolation
   */
  function normaliseState(raw, receivedAt = Date.now()) {
    let value = raw;
    if (value && typeof value === 'object' && typeof value.status === 'string' && !value.auth) value = { auth: value };
    const auth = value && typeof value.auth === 'object' && typeof value.auth.status === 'string' ? value.auth : { status: 'signed-out' };
    const track = value && value.track && typeof value.track === 'object' ? value.track : undefined;
    const state = {
      auth,
      playing: Boolean(value && value.playing && track),
      idle: value && typeof value.idle === 'boolean' ? value.idle : !track,
      receivedAt
    };
    if (track) {
      state.track = {
        id: String(track.id || track.uri || ''),
        uri: String(track.uri || ''),
        title: String(track.title || ''),
        artists: Array.isArray(track.artists) ? track.artists.map(String) : [],
        album: String(track.album || ''),
        durationMs: Number.isFinite(track.durationMs) ? Math.max(0, track.durationMs) : 0,
        ...(track.artUrl ? { artUrl: String(track.artUrl) } : {})
      };
    }
    if (Number.isFinite(value?.progressMs)) state.progressMs = Math.max(0, value.progressMs);
    if (typeof value?.shuffle === 'boolean') state.shuffle = value.shuffle;
    if (value?.repeat === 'off' || value?.repeat === 'track' || value?.repeat === 'context') state.repeat = value.repeat;
    if (Number.isFinite(value?.volume)) state.volume = clamp(Math.round(value.volume), 0, MAX_VOLUME);
    if (value?.device && typeof value.device === 'object') state.device = value.device;
    return state;
  }

  /**
   * Current playback position. While playing the position advances with the local clock since `receivedAt`.
   * @param {{ progressMs?: number, playing?: boolean, receivedAt?: number, track?: { durationMs: number } }} state
   * @param {number} now
   */
  function interpolateProgress(state, now) {
    if (!state || !state.track) return 0;
    const base = Number.isFinite(state.progressMs) ? state.progressMs : 0;
    const elapsed = state.playing && Number.isFinite(state.receivedAt) ? Math.max(0, now - state.receivedAt) : 0;
    const duration = state.track.durationMs;
    const position = base + elapsed;
    return duration > 0 ? clamp(position, 0, duration) : Math.max(0, position);
  }

  /** Fraction 0..1 of the current track that has played. */
  function progressFraction(state, now) {
    const duration = state?.track?.durationMs || 0;
    return duration > 0 ? clamp(interpolateProgress(state, now) / duration, 0, 1) : 0;
  }

  /** True when the interpolated position reached the end of a playing track (the widget then asks for a refresh). */
  function reachedTrackEnd(state, now) {
    const duration = state?.track?.durationMs || 0;
    return Boolean(state?.playing) && duration > 0 && interpolateProgress(state, now) >= duration;
  }

  /** "3:07" or "1:02:03". */
  function formatClock(ms) {
    const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  }

  const ACTION_LABELS = Object.freeze({
    prev: 'Previous', toggle: 'Play', next: 'Next', shuffle: 'Shuffle', repeat: 'Repeat',
    'volume-down': 'Volume down', 'volume-up': 'Volume up', library: 'Library',
    'open-spotify': 'Open Spotify', login: 'Connect Spotify', retry: 'Retry'
  });

  /**
   * Maps a normalised state to what the widget shows.
   * `cardActions` render inside the compact card (call-to-action buttons), `controls` render in the expanding pill.
   * Together they form the ordered focus stops. `interactive` is false when there is nothing to focus.
   * @returns {{
   *   kind: 'unconfigured'|'signed-out'|'signing-in'|'idle'|'playing'|'paused'|'error',
   *   title: string, subtitle: string, detail: string, artUrl: string,
   *   cardActions: ActionId[], controls: ActionId[], interactive: boolean, hasTrack: boolean,
   *   shuffle: boolean, repeat: 'off'|'track'|'context', volume: number | null
   * }}
   */
  function buildViewModel(input) {
    const state = input && input.auth ? input : normaliseState(input);
    const base = {
      title: '', subtitle: '', detail: '', artUrl: '', cardActions: [], controls: [], hasTrack: false,
      shuffle: false, repeat: 'off', volume: null
    };
    const finish = (model) => ({ ...model, interactive: model.cardActions.length + model.controls.length > 0 });
    const auth = state.auth;
    switch (auth.status) {
      case 'unconfigured':
        return finish({ ...base, kind: 'unconfigured', title: 'Spotify is not set up', subtitle: 'Add SPOTIFY_CLIENT_ID to .env and restart.', detail: 'See backend/spotify/README for the 2-minute setup.' });
      case 'signed-out':
        return finish({ ...base, kind: 'signed-out', title: 'Connect Spotify', subtitle: 'Control your music from the couch.', cardActions: ['login'] });
      case 'signing-in':
        return finish({ ...base, kind: 'signing-in', title: 'Finish signing in in your browser', subtitle: typeof auth.url === 'string' && auth.url ? auth.url : 'Waiting for Spotify...', detail: typeof auth.url === 'string' ? auth.url : '', cardActions: ['login'] });
      case 'error':
        return finish({ ...base, kind: 'error', title: 'Spotify is unavailable', subtitle: friendlyError(auth.message), cardActions: ['retry', 'login'] });
      default:
        break;
    }
    // signed-in
    const track = state.track;
    if (!track || state.idle) {
      return finish({ ...base, kind: 'idle', title: 'Nothing playing', subtitle: 'Start Spotify on this device.', cardActions: ['open-spotify'], controls: ['library'] });
    }
    return finish({
      ...base,
      kind: state.playing ? 'playing' : 'paused',
      title: track.title || 'Unknown track',
      subtitle: track.artists.join(', ') || track.album,
      artUrl: track.artUrl || '',
      hasTrack: true,
      controls: ['prev', 'toggle', 'next', 'shuffle', 'repeat', 'volume-down', 'volume-up', 'library'],
      shuffle: Boolean(state.shuffle),
      repeat: state.repeat || 'off',
      volume: Number.isFinite(state.volume) ? state.volume : null
    });
  }

  /** Short, non-technical message for the error card. */
  function friendlyError(message) {
    const text = String(message || '').trim();
    if (!text) return 'Check your connection and try again.';
    if (/network|fetch|timeout|offline|ENOTFOUND|ECONN/i.test(text)) return 'No connection to Spotify. Check the network and try again.';
    if (/premium/i.test(text)) return 'Spotify Premium is required to control playback.';
    return text.length > 96 ? `${text.slice(0, 93)}...` : text;
  }

  const CODE_MESSAGES = Object.freeze({
    UNCONFIGURED: 'Spotify is not set up. Add SPOTIFY_CLIENT_ID.',
    AUTH: 'Spotify sign-in expired. Connect again.',
    OFFLINE: 'No connection to Spotify. Check the network.',
    RATE_LIMITED: 'Spotify is busy. Try again in a moment.',
    PREMIUM_REQUIRED: 'Spotify Premium required to control playback.',
    NO_ACTIVE_DEVICE: 'No active Spotify device. Open Spotify first.',
    NO_DEVICE: 'No active Spotify device. Open Spotify first.',
    VOLUME_CONTROL_DISALLOW: 'This device does not allow volume control.'
  });

  /** Friendly text for a backend `{ ok: false, error, code }` result. */
  function friendlyCode(code, fallback) {
    return CODE_MESSAGES[code] || friendlyError(fallback);
  }

  /** Accessible / visible label of an action in the context of a view model. */
  function actionLabel(id, model) {
    if (id === 'toggle') return model && model.kind === 'playing' ? 'Pause' : 'Play';
    if (id === 'shuffle') return model && model.shuffle ? 'Shuffle on' : 'Shuffle off';
    if (id === 'repeat') return `Repeat ${model && model.repeat === 'context' ? 'all' : model && model.repeat === 'track' ? 'one' : 'off'}`;
    return ACTION_LABELS[id] || id;
  }

  /** Command string of the `media.control` contract for a playback action, or null for non-playback actions. */
  function commandFor(id, model) {
    switch (id) {
      case 'prev': return 'previous';
      case 'toggle': return model && model.kind === 'playing' ? 'pause' : 'play';
      case 'next': return 'next';
      case 'shuffle': case 'repeat': case 'volume-up': case 'volume-down': return id;
      default: return null;
    }
  }

  /**
   * Predicts the state after a command so the widget reacts instantly; the next backend event replaces it.
   * @param {ReturnType<typeof normaliseState>} state
   * @param {string} command MediaCommand
   */
  function applyOptimistic(state, command) {
    const next = { ...state };
    switch (command) {
      case 'play': if (state.track) next.playing = true; break;
      case 'pause': next.playing = false; break;
      case 'toggle': if (state.track) next.playing = !state.playing; break;
      case 'shuffle': next.shuffle = !state.shuffle; break;
      case 'repeat': next.repeat = REPEAT_CYCLE[state.repeat || 'off']; break;
      case 'volume-up': next.volume = clamp((Number.isFinite(state.volume) ? state.volume : 50) + VOLUME_STEP, 0, MAX_VOLUME); break;
      case 'volume-down': next.volume = clamp((Number.isFinite(state.volume) ? state.volume : 50) - VOLUME_STEP, 0, MAX_VOLUME); break;
      default: break;
    }
    if (next.playing !== state.playing || command === 'play' || command === 'pause' || command === 'toggle') {
      // Re-anchor the interpolation so the bar neither jumps nor drifts across the play/pause edge.
      next.progressMs = interpolateProgress(state, next.receivedAt = Date.now());
    }
    return next;
  }

  /**
   * Toast text for a global media key press. `kind` is the remote-keymap action.
   * Returns null when the press does nothing (nothing to control).
   */
  function toastFor(kind, state) {
    const track = state && state.track;
    const label = track ? `${track.title}${track.artists.length ? ` - ${track.artists.join(', ')}` : ''}` : '';
    switch (kind) {
      case 'playpause': return track ? (state.playing ? `Playing: ${label}` : 'Paused') : 'Nothing playing';
      case 'stop': return 'Paused';
      case 'next': return 'Next track';
      case 'previous': return 'Previous track';
      default: return null;
    }
  }

  /**
   * remote-keymap action -> media command, honouring the current state (play/pause is explicit so the optimistic
   * toast is right even with stale state). `stop` pauses; Spotify has no stop.
   */
  function commandForRemoteAction(action, state) {
    switch (action) {
      case 'playpause': return state && state.playing ? 'pause' : 'play';
      case 'stop': return 'pause';
      case 'next': return 'next';
      case 'previous': return 'previous';
      default: return null;
    }
  }

  /**
   * Widget-internal focus model: one focus stop in the home navigation, Left/Right between its buttons.
   * `handle` returns an effect for the renderer to execute.
   * @typedef {{ type: 'focus', index: number } | { type: 'activate', id: ActionId } | { type: 'leave', direction: 'up'|'down'|'system' } | { type: 'none' }} Effect
   */
  class WidgetFocusModel {
    /** @param {ActionId[]} [order] */
    constructor(order = []) { this.order = [...order]; this.index = 0; }

    get current() { return this.order[this.index] ?? null; }

    /** Replaces the stops, keeping the same action focused when it still exists, else the primary one. */
    setOrder(order, preferred) {
      const keep = preferred ?? this.current;
      this.order = [...order];
      const kept = keep ? this.order.indexOf(keep) : -1;
      this.index = kept >= 0 ? kept : this.defaultIndex();
    }

    /** Entry stop: play/pause when present, else the first stop. */
    defaultIndex() {
      const primary = this.order.indexOf('toggle');
      return primary >= 0 ? primary : 0;
    }

    resetToDefault() { this.index = this.defaultIndex(); }

    /** @param {'up'|'down'|'left'|'right'|'confirm'|'back'|'menu'} action @returns {Effect} */
    handle(action) {
      if (!this.order.length) return action === 'up' || action === 'down' || action === 'back' || action === 'menu'
        ? { type: 'leave', direction: action === 'up' ? 'up' : action === 'back' ? 'system' : 'down' } : { type: 'none' };
      switch (action) {
        case 'left': case 'right': {
          const next = clamp(this.index + (action === 'left' ? -1 : 1), 0, this.order.length - 1);
          if (next === this.index) return { type: 'none' };
          this.index = next;
          return { type: 'focus', index: next };
        }
        case 'confirm': return { type: 'activate', id: this.order[this.index] };
        case 'up': return { type: 'leave', direction: 'up' };
        // Back mirrors the tiles: focus goes to the quick-settings button. Down returns to the remembered tile.
        case 'back': return { type: 'leave', direction: 'system' };
        case 'down': case 'menu': return { type: 'leave', direction: 'down' };
        default: return { type: 'none' };
      }
    }
  }

  /**
   * Dominant colour of an RGBA pixel buffer (e.g. a 16x16 downscale of the cover). Favours saturated, mid-bright pixels
   * so the glow is colourful rather than muddy. Returns null for an empty or fully transparent buffer.
   * @param {ArrayLike<number>} data
   * @returns {{ r: number, g: number, b: number } | null}
   */
  function dominantColour(data) {
    let sumR = 0; let sumG = 0; let sumB = 0; let weightSum = 0;
    for (let index = 0; index + 3 < data.length; index += 4) {
      if (data[index + 3] < 128) continue;
      const r = data[index]; const g = data[index + 1]; const b = data[index + 2];
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const brightness = max / 255;
      // Weight: colourful beats grey, near-black and near-white count little.
      const weight = 0.05 + saturation * saturation * (1 - Math.abs(brightness - 0.6));
      sumR += r * weight; sumG += g * weight; sumB += b * weight; weightSum += weight;
    }
    if (weightSum === 0) return null;
    return { r: Math.round(sumR / weightSum), g: Math.round(sumG / weightSum), b: Math.round(sumB / weightSum) };
  }

  /** Dims a colour to a OLED-friendly glow tone (never brighter than ~70% value). */
  function glowCss(colour, fallback = 'var(--accent)') {
    if (!colour) return fallback;
    const peak = Math.max(colour.r, colour.g, colour.b, 1);
    const scale = Math.min(1, 178 / peak);
    return `rgb(${Math.round(colour.r * scale)} ${Math.round(colour.g * scale)} ${Math.round(colour.b * scale)})`;
  }

  return {
    VOLUME_STEP, normaliseState, interpolateProgress, progressFraction, reachedTrackEnd, formatClock, buildViewModel,
    friendlyError, friendlyCode, actionLabel, commandFor, applyOptimistic, toastFor, commandForRemoteAction, WidgetFocusModel,
    dominantColour, glowCss
  };
});
