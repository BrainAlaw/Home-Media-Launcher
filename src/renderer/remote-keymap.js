(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RemoteKeymap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Pure (DOM-free) key mapping and press-state machine for Bluetooth/USB remotes
   * (Fire TV, Google TV / Chromecast, generic HID and air-mouse remotes).
   *
   * @typedef {'up'|'down'|'left'|'right'|'select'|'back'|'home'|'menu'|'playpause'|'context'
   *   |'pageup'|'pagedown'|'next'|'previous'|'stop'|'red'|'green'|'yellow'|'blue'} RemoteActionName
   * The first ten values are the `RemoteAction` contract; the rest are launcher-local extensions.
   * @typedef {'repeat'|'long'|'once'} Behaviour
   * @typedef {{ action: RemoteActionName, behaviour: Behaviour, exclusive: boolean }} Resolved
   * `exclusive` marks keys a plain keyboard never produces (used to detect "last input device = remote").
   */

  const TIMING = Object.freeze({
    /** Hold time before the first auto-repeat of a direction key. */
    initialDelayMs: 350,
    /** Repeat interval at the start of a hold; shrinks while the key stays down (see repeatInterval). */
    repeatIntervalMs: 90,
    /** Select/Home held at least this long becomes a long press. */
    longPressMs: 500
  });

  /** Keys that must reach the OS untouched (volume, power). */
  const PASSTHROUGH_KEYS = new Set([
    'AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute', 'VolumeUp', 'VolumeDown', 'VolumeMute',
    'MicrophoneVolumeMute', 'Power', 'PowerOff', 'Standby', 'BrightnessUp', 'BrightnessDown'
  ]);

  const def = (action, behaviour, exclusive = false) => Object.freeze({ action, behaviour, exclusive });

  /** DOM `KeyboardEvent.key` (or `.code`) -> mapping. `key` is looked up first, then `code`. */
  const KEY_MAP = {
    ArrowUp: def('up', 'repeat'), ArrowDown: def('down', 'repeat'),
    ArrowLeft: def('left', 'repeat'), ArrowRight: def('right', 'repeat'),
    Enter: def('select', 'long'), NumpadEnter: def('select', 'long'), Select: def('select', 'long', true),
    Escape: def('back', 'once'), Backspace: def('back', 'once'),
    BrowserBack: def('back', 'once', true), GoBack: def('back', 'once', true), Exit: def('back', 'once', true),
    BrowserHome: def('home', 'long', true), Home: def('home', 'long'), Meta: def('home', 'long'),
    ContextMenu: def('menu', 'once'), Menu: def('menu', 'once', true), F1: def('menu', 'once'), Info: def('menu', 'once', true),
    MediaPlayPause: def('playpause', 'once', true), MediaPlay: def('playpause', 'once', true), MediaPause: def('playpause', 'once', true),
    MediaStop: def('stop', 'once', true),
    MediaTrackNext: def('next', 'once', true), MediaTrackPrevious: def('previous', 'once', true),
    MediaFastForward: def('next', 'once', true), MediaRewind: def('previous', 'once', true),
    ChannelUp: def('pageup', 'repeat', true), ChannelDown: def('pagedown', 'repeat', true),
    PageUp: def('pageup', 'repeat'), PageDown: def('pagedown', 'repeat'),
    ColorF0Red: def('red', 'once', true), ColorF1Green: def('green', 'once', true),
    ColorF2Yellow: def('yellow', 'once', true), ColorF3Blue: def('blue', 'once', true)
  };

  /**
   * Android keycodes surfaced by some stacks as `key === 'Unidentified'` with only the legacy numeric `keyCode`.
   * Only consulted when the event carries no usable `key`/`code`.
   */
  const ANDROID_KEYCODES = {
    3: def('home', 'long', true), 4: def('back', 'once', true), 82: def('menu', 'once', true), 165: def('menu', 'once', true),
    19: def('up', 'repeat', true), 20: def('down', 'repeat', true), 21: def('left', 'repeat', true), 22: def('right', 'repeat', true),
    23: def('select', 'long', true), 66: def('select', 'long', true),
    85: def('playpause', 'once', true), 126: def('playpause', 'once', true), 127: def('playpause', 'once', true),
    86: def('stop', 'once', true), 87: def('next', 'once', true), 88: def('previous', 'once', true),
    89: def('previous', 'once', true), 90: def('next', 'once', true),
    92: def('pageup', 'repeat', true), 93: def('pagedown', 'repeat', true),
    166: def('pageup', 'repeat', true), 167: def('pagedown', 'repeat', true),
    183: def('red', 'once', true), 184: def('green', 'once', true), 185: def('yellow', 'once', true), 186: def('blue', 'once', true)
  };

  const isBlank = (value) => value === undefined || value === null || value === '' || value === 'Unidentified' || value === 'Dead';

  /**
   * @param {{ key?: string, code?: string, keyCode?: number }} event
   * @returns {{ passthrough: true } | (Resolved & { passthrough?: false }) | null} null when the key is not a remote key
   */
  function resolveKey(event) {
    if (!event) return null;
    const { key, code, keyCode } = event;
    if (PASSTHROUGH_KEYS.has(key) || PASSTHROUGH_KEYS.has(code)) return { passthrough: true };
    if (!isBlank(key) && KEY_MAP[key]) return { ...KEY_MAP[key], source: key };
    if (!isBlank(code) && KEY_MAP[code]) return { ...KEY_MAP[code], source: code };
    if (isBlank(key) && Number.isInteger(keyCode) && ANDROID_KEYCODES[keyCode]) return { ...ANDROID_KEYCODES[keyCode], source: `keyCode:${keyCode}` };
    return null;
  }

  /**
   * Auto-repeat interval for the n-th repeat (0-based) of a held direction key. Accelerates on long scrolls:
   * 90 ms for the first 8 repeats, 65 ms until 20, then 45 ms.
   * @param {number} index
   * @param {number} [base]
   */
  function repeatInterval(index, base = TIMING.repeatIntervalMs) {
    if (index < 8) return base;
    if (index < 20) return Math.round(base * 0.72);
    return Math.round(base * 0.5);
  }

  /** Actions that have a canonical keyboard equivalent the existing keyboard path already understands. */
  const SYNTHETIC_KEYS = {
    up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    select: { key: 'Enter', code: 'Enter', keyCode: 13 },
    back: { key: 'Escape', code: 'Escape', keyCode: 27 },
    menu: { key: 'ContextMenu', code: 'ContextMenu', keyCode: 93 },
    context: { key: 'ContextMenu', code: 'ContextMenu', keyCode: 93 },
    pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 }
  };

  /**
   * Press-state machine: turns raw key down/up events into discrete actions with 10-foot tuned repeat and
   * long-press detection. Timers are injected so the class is unit-testable without a DOM.
   */
  class RemoteKeyTracker {
    /**
     * @param {{
     *   emit: (event: { action: RemoteActionName, long: boolean, source: string }) => void,
     *   setTimer?: (callback: () => void, ms: number) => unknown,
     *   clearTimer?: (handle: unknown) => void,
     *   timing?: Partial<typeof TIMING>
     * }} options
     */
    constructor(options) {
      this.emit = options.emit;
      this.setTimer = options.setTimer || ((callback, ms) => setTimeout(callback, ms));
      this.clearTimer = options.clearTimer || ((handle) => clearTimeout(handle));
      this.timing = { ...TIMING, ...(options.timing || {}) };
      /** @type {Map<string, { resolved: Resolved & { source: string }, timer: unknown, fired: boolean, repeats: number, chorded: boolean }>} */
      this.active = new Map();
    }

    /** @param {{ key?: string, code?: string, keyCode?: number }} event */
    static idOf(event) {
      return `${isBlank(event.code) ? '' : event.code}|${isBlank(event.key) ? '' : event.key}|${event.keyCode || 0}`;
    }

    /**
     * @param {{ key?: string, code?: string, keyCode?: number, repeat?: boolean, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean }} event
     * @returns {boolean} true when the event was consumed (caller should preventDefault and stop propagation)
     */
    keyDown(event) {
      const resolved = resolveKey(event);
      if (!resolved || resolved.passthrough) {
        // Any other key while Meta is down means a desktop chord (Super+X), not a Home press.
        for (const entry of this.active.values()) if (entry.resolved.source === 'Meta') entry.chorded = true;
        return false;
      }
      const isMeta = resolved.source === 'Meta';
      if (!isMeta && (event.ctrlKey || event.altKey || event.metaKey)) {
        for (const entry of this.active.values()) if (entry.resolved.source === 'Meta') entry.chorded = true;
        return false;
      }
      const id = RemoteKeyTracker.idOf(event);
      if (this.active.has(id)) return !isMeta; // OS auto-repeat: our own timers drive repeats; Meta stays unconsumed.
      for (const entry of this.active.values()) if (entry.resolved.source === 'Meta') entry.chorded = true;

      const entry = { resolved, timer: null, fired: false, repeats: 0, chorded: false };
      this.active.set(id, entry);
      if (resolved.behaviour === 'repeat') {
        this.emit({ action: resolved.action, long: false, source: resolved.source });
        entry.timer = this.setTimer(() => this.repeatTick(id), this.timing.initialDelayMs);
      } else if (resolved.behaviour === 'long') {
        entry.timer = this.setTimer(() => {
          const current = this.active.get(id);
          if (!current || current.chorded) return;
          current.fired = true;
          current.timer = null;
          this.emit({ action: resolved.action === 'select' ? 'context' : resolved.action, long: true, source: resolved.source });
        }, this.timing.longPressMs);
      } else {
        this.emit({ action: resolved.action, long: false, source: resolved.source });
      }
      return !isMeta;
    }

    /** @param {string} id */
    repeatTick(id) {
      const entry = this.active.get(id);
      if (!entry) return;
      this.emit({ action: entry.resolved.action, long: false, source: entry.resolved.source });
      entry.timer = this.setTimer(() => this.repeatTick(id), repeatInterval(entry.repeats, this.timing.repeatIntervalMs));
      entry.repeats += 1;
    }

    /**
     * @param {{ key?: string, code?: string, keyCode?: number }} event
     * @returns {boolean} true when the event belonged to a tracked press
     */
    keyUp(event) {
      const id = RemoteKeyTracker.idOf(event);
      const entry = this.active.get(id);
      if (!entry) return false;
      this.active.delete(id);
      if (entry.timer !== null) this.clearTimer(entry.timer);
      const isMeta = entry.resolved.source === 'Meta';
      if (entry.resolved.behaviour === 'long' && !entry.fired && !entry.chorded) {
        this.emit({ action: entry.resolved.action, long: false, source: entry.resolved.source });
      }
      return !isMeta;
    }

    /** Cancels every pending press without emitting (window blur, launcher hidden behind a game). */
    releaseAll() {
      for (const entry of this.active.values()) if (entry.timer !== null) this.clearTimer(entry.timer);
      this.active.clear();
    }
  }

  return { TIMING, KEY_MAP, ANDROID_KEYCODES, PASSTHROUGH_KEYS, SYNTHETIC_KEYS, resolveKey, repeatInterval, RemoteKeyTracker };
});
