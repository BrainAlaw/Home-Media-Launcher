/**
 * Remote-control input (Fire TV / Google TV / generic HID remotes) for the renderer.
 *
 * Integration strategy: remote keys are normalised by RemoteKeymap and replayed as canonical *keyboard* events
 * (ArrowUp, Enter, Escape, ContextMenu) so they travel the exact same path as a real keyboard in app.js, the
 * navigation menu and spatial navigation. No routing logic is duplicated here.
 *
 * Public DOM events (dispatched on `document`):
 *   - `launcher:remote-action`  CustomEvent<{ action, long, source }>, cancelable.
 *        action: RemoteAction contract values plus 'pageup' | 'pagedown' | 'next' | 'previous' | 'stop' |
 *                'red' | 'green' | 'yellow' | 'blue'.
 *        long:   true for a hold (Select held >= 500 ms => { action: 'context', long: true };
 *                Home held >= 500 ms => { action: 'home', long: true }, intended for the close-app overlay).
 *        Calling preventDefault() suppresses the default keyboard replay (and the default Home behaviour).
 *   - `launcher:input-device`   CustomEvent<{ device }> with device 'remote' | 'keyboard' | 'gamepad' | 'pointer'.
 *        The same value is mirrored in `document.body.dataset.inputDevice` so CSS can swap hint glyphs.
 */
(function () {
  'use strict';

  const { RemoteKeyTracker, SYNTHETIC_KEYS, resolveKey } = window.RemoteKeymap;
  const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
  const GAMEPAD_POLL_MS = 400;

  let device = '';

  function setDevice(next) {
    if (device === next) return;
    device = next;
    document.body.dataset.inputDevice = next;
    document.dispatchEvent(new CustomEvent('launcher:input-device', { detail: { device: next } }));
  }

  function replayAsKeyboard(action) {
    const spec = SYNTHETIC_KEYS[action];
    if (!spec) return;
    const target = document.activeElement || document.body;
    // Untrusted events are ignored by this module's own listeners, so replay cannot loop.
    target.dispatchEvent(new KeyboardEvent('keydown', { ...spec, bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { ...spec, bubbles: true, cancelable: true }));
  }

  function onEmit(detail) {
    const event = new CustomEvent('launcher:remote-action', { detail, cancelable: true });
    document.dispatchEvent(event);
    if (event.defaultPrevented) return;
    if (detail.action === 'home') {
      // Tap on Home behaves like Back (returns focus to the navigation menu); a hold is left to the overlay owner.
      if (!detail.long) replayAsKeyboard('back');
      return;
    }
    replayAsKeyboard(detail.action);
  }

  const tracker = new RemoteKeyTracker({ emit: onEmit });

  function isEditableTarget(event) {
    return event.target instanceof Element && event.target.matches(EDITABLE);
  }

  document.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    const resolved = resolveKey(event);
    if (resolved && !resolved.passthrough) {
      setDevice(resolved.exclusive ? 'remote' : 'keyboard');
      document.body.classList.add('cursor-hidden');
    } else if (!resolved) {
      setDevice('keyboard');
    }
    if (isEditableTarget(event)) return;
    if (tracker.keyDown(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('keyup', (event) => {
    if (!event.isTrusted) return;
    if (tracker.keyUp(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('blur', () => tracker.releaseAll());
  document.addEventListener('visibilitychange', () => { if (document.hidden) tracker.releaseAll(); });

  document.addEventListener('pointermove', (event) => {
    if (event.isTrusted && event.pointerType === 'mouse' && (event.movementX || event.movementY)) setDevice('pointer');
  }, { passive: true });

  // Cheap gamepad activity probe: only inspects pads while at least one is connected.
  setInterval(() => {
    if (document.hidden || !navigator.getGamepads) return;
    for (const pad of Array.from(navigator.getGamepads())) {
      if (pad && pad.connected && (pad.buttons.some((button) => button.pressed) || pad.axes.some((axis) => Math.abs(axis) > 0.6))) {
        setDevice('gamepad');
        return;
      }
    }
  }, GAMEPAD_POLL_MS);

  window.RemoteInput = { tracker, get device() { return device; } };
})();
