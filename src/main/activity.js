'use strict';

/**
 * Activity gate: background pollers (network, VPN, input devices, ...) must not wake up while an
 * external application (game, Moonlight stream, web app) owns the screen. The gate follows the session
 * phase machine: `launching` / `running` / `closing` = suspended, `idle` = active.
 */

const SUSPENDED_PHASES = new Set(['launching', 'running', 'closing']);

function createActivityGate() {
  let suspended = false;
  const listeners = new Set();

  function setSuspended(next) {
    const value = Boolean(next);
    if (value === suspended) return;
    suspended = value;
    for (const listener of [...listeners]) {
      try { listener(suspended); } catch (error) { console.warn('Activity listener failed:', error.message); }
    }
  }

  return {
    get suspended() { return suspended; },
    /** @param {string | { phase: string }} phase session phase name or snapshot */
    setPhase(phase) { setSuspended(SUSPENDED_PHASES.has(typeof phase === 'string' ? phase : phase?.phase)); },
    setSuspended,
    /** @returns {() => void} unsubscribe */
    onChange(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
  };
}

/** Process-wide gate, driven from the session `onPhase` hook in index.js. */
const gate = createActivityGate();

/**
 * Interval poller that honours a gate. While suspended there is no timer and any in-flight poll is
 * aborted (its AbortSignal fires and its result is ignored); on resume exactly one immediate refresh runs
 * before the interval restarts. Polls never overlap. `refreshNow()` is for user-triggered refreshes and
 * is not blocked by the gate.
 *
 * @param {{ gate?: ReturnType<typeof createActivityGate>, intervalMs: number, task: (signal: AbortSignal) => Promise<unknown> | unknown,
 *   setIntervalFn?: typeof setInterval, clearIntervalFn?: typeof clearInterval }} options
 */
function createGatedPoller({ gate: activity = gate, intervalMs, task, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let timer = null;
  let running = false;
  let inflight = null;
  let controller = null;
  let unsubscribe = null;

  function run() {
    if (inflight) return inflight;
    const own = new AbortController();
    controller = own;
    const done = () => { if (controller === own) { controller = null; inflight = null; } };
    const promise = Promise.resolve().then(() => task(own.signal)).catch(() => undefined).finally(done);
    inflight = promise;
    return promise;
  }

  function arm() {
    clearIntervalFn(timer);
    timer = setIntervalFn(() => { if (!activity.suspended) void run(); }, intervalMs);
    timer.unref?.();
  }

  function disarm() {
    clearIntervalFn(timer);
    timer = null;
    controller?.abort();
    controller = null;
    inflight = null;
  }

  return {
    start() {
      if (running) return;
      running = true;
      unsubscribe = activity.onChange((isSuspended) => {
        if (isSuspended) disarm();
        else { void run(); arm(); }
      });
      if (!activity.suspended) { void run(); arm(); }
    },
    stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = null;
      disarm();
    },
    refreshNow: run,
    get active() { return timer !== null; }
  };
}

module.exports = { createActivityGate, createGatedPoller, gate, SUSPENDED_PHASES };
