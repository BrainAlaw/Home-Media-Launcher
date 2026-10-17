(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GamepadInput = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** @typedef {'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'menu'} Action */

  // Standard Gamepad API mapping.
  const BUTTON = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const REPEATABLE = new Set(['up', 'down', 'left', 'right']);
  // If polling stalled for this long (launcher hidden behind a game), held inputs are ignored until released.
  const RESUME_GAP_MS = 500;

  /**
   * Polls connected gamepads once per frame and emits edge-triggered navigation actions.
   * Directions auto-repeat while held; stick input is reduced to a single dominant axis.
   */
  class GamepadInput {
    /**
     * @param {{
     *   onAction: (action: Action) => void,
     *   getGamepads?: () => ArrayLike<any>,
     *   requestFrame?: (callback: (time: number) => void) => number,
     *   cancelFrame?: (handle: number) => void,
     *   deadzone?: number, repeatDelay?: number, repeatInterval?: number
     * }} options
     */
    constructor(options) {
      this.onAction = options.onAction;
      this.getGamepads = options.getGamepads || (() => (typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []));
      this.requestFrame = options.requestFrame || ((callback) => requestAnimationFrame(callback));
      this.cancelFrame = options.cancelFrame || ((handle) => cancelAnimationFrame(handle));
      this.deadzone = options.deadzone ?? 0.55;
      this.repeatDelay = options.repeatDelay ?? 380;
      this.repeatInterval = options.repeatInterval ?? 90;
      /** @type {Map<number, Map<Action, { next: number }>>} */
      this.held = new Map();
      this.lastPoll = -Infinity;
      this.frame = 0;
      this.running = false;
    }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = (time) => {
        if (!this.running) return;
        this.poll(time);
        this.frame = this.requestFrame(loop);
      };
      this.frame = this.requestFrame(loop);
    }

    stop() {
      this.running = false;
      this.cancelFrame(this.frame);
    }

    /** @param {any} pad @returns {Set<Action>} */
    activeActions(pad) {
      const active = new Set();
      const pressed = (index) => Boolean(pad.buttons[index]?.pressed);
      const x = pad.axes[0] || 0;
      const y = pad.axes[1] || 0;
      const stickHorizontal = Math.abs(x) >= Math.abs(y);
      if (pressed(BUTTON.LEFT) || (stickHorizontal && x < -this.deadzone)) active.add('left');
      if (pressed(BUTTON.RIGHT) || (stickHorizontal && x > this.deadzone)) active.add('right');
      if (pressed(BUTTON.UP) || (!stickHorizontal && y < -this.deadzone)) active.add('up');
      if (pressed(BUTTON.DOWN) || (!stickHorizontal && y > this.deadzone)) active.add('down');
      if (pressed(BUTTON.A)) active.add('confirm');
      if (pressed(BUTTON.B)) active.add('back');
      if (pressed(BUTTON.START)) active.add('menu');
      return active;
    }

    /** @param {number} time DOMHighResTimeStamp of the current frame */
    poll(time) {
      const resuming = time - this.lastPoll > RESUME_GAP_MS;
      this.lastPoll = time;
      const seen = new Set();
      for (const pad of Array.from(this.getGamepads() || [])) {
        if (!pad || pad.connected === false) continue;
        seen.add(pad.index);
        const state = this.held.get(pad.index) || new Map();
        this.held.set(pad.index, state);
        const active = this.activeActions(pad);
        for (const action of [...state.keys()]) if (!active.has(action)) state.delete(action);
        for (const action of active) {
          const entry = state.get(action);
          if (!entry) {
            // After a resume gap, inputs already held are swallowed until released.
            state.set(action, { next: resuming ? Infinity : time + this.repeatDelay });
            if (!resuming) this.onAction(action);
          } else if (REPEATABLE.has(action) && time >= entry.next) {
            entry.next = time + this.repeatInterval;
            this.onAction(action);
          }
        }
      }
      for (const index of [...this.held.keys()]) if (!seen.has(index)) this.held.delete(index);
    }
  }

  return { GamepadInput, BUTTON };
});
