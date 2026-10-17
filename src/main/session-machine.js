'use strict';

/**
 * Pure launch-session state machine: idle -> launching -> running -> closing -> idle.
 * `launching` may jump straight to `closing` (fast exit, launch failure) and any phase may be reset to `idle`.
 * Listeners only see real changes, so repeated notifications from independent exit sources are harmless.
 */
const IDLE = Object.freeze({ phase: 'idle' });

function createSessionMachine({ onChange } = {}) {
  /** @type {{ phase: 'idle' } | { phase: 'launching' | 'running' | 'closing', tileId: string, name: string }} */
  let current = IDLE;

  function enter(next) {
    current = next;
    onChange?.({ ...current });
    return true;
  }

  return {
    get phase() { return current.phase; },
    get active() { return current.phase !== 'idle'; },
    snapshot() { return { ...current }; },
    /** @returns {boolean} false when a session is already in flight */
    beginLaunch(tileId, name) {
      if (current.phase !== 'idle') return false;
      return enter({ phase: 'launching', tileId: String(tileId), name: String(name || tileId) });
    },
    /** @returns {boolean} true only for launching -> running */
    markRunning() {
      if (current.phase !== 'launching') return false;
      return enter({ ...current, phase: 'running' });
    },
    /** @returns {boolean} false when idle or already closing */
    beginClosing() {
      if (current.phase !== 'launching' && current.phase !== 'running') return false;
      return enter({ ...current, phase: 'closing' });
    },
    /** Ends the session from any phase. @returns {boolean} false when already idle */
    finish() {
      if (current.phase === 'idle') return false;
      return enter(IDLE);
    }
  };
}

module.exports = { createSessionMachine };
