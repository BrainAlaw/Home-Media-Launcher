'use strict';

const { readNetwork } = require('../../../backend/network-status');
const { createGatedPoller, gate } = require('../activity');

const POLL_INTERVAL_MS = 10_000;
let poller = null;
let current = { type: 'unknown', connected: false };
let signature = JSON.stringify(current);
let inflight = null;
let primed = false;

/** Non-overlapping async refresh; emits `network` only when the status actually changed. */
function refresh(ctx, signal) {
  if (inflight) return inflight;
  const own = readNetwork().then((status) => {
    if (signal?.aborted) return current;
    const first = !primed;
    primed = true;
    const next = JSON.stringify(status);
    if (first || next !== signature) { signature = next; current = status; ctx.emit('network', status); }
    return current;
  }).catch(() => current).finally(() => { if (inflight === own) inflight = null; });
  inflight = own;
  // An aborted probe (session started) must not block the refresh that follows the resume.
  signal?.addEventListener('abort', () => { if (inflight === own) inflight = null; }, { once: true });
  return own;
}

module.exports = {
  namespace: 'system',
  handlers: {
    /** Returns the cached status once primed; the first call waits for the initial probe. */
    getNetwork: async (ctx) => {
      if (primed) { if (!gate.suspended) refresh(ctx); return current; }
      return refresh(ctx);
    }
  },
  start(ctx) {
    poller = createGatedPoller({ intervalMs: POLL_INTERVAL_MS, task: (signal) => refresh(ctx, signal) });
    poller.start();
  },
  stop() { poller?.stop(); poller = null; }
};
