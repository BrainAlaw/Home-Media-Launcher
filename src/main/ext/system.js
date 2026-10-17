'use strict';

const { readNetwork } = require('../../../backend/network-status');

const POLL_INTERVAL_MS = 10_000;
let timer = null;
let current = { type: 'unknown', connected: false };
let signature = JSON.stringify(current);
let inflight = null;
let primed = false;

/** Non-overlapping async refresh; emits `network` only when the status actually changed. */
function refresh(ctx) {
  if (inflight) return inflight;
  inflight = readNetwork().then((status) => {
    const first = !primed;
    primed = true;
    const next = JSON.stringify(status);
    if (first || next !== signature) { signature = next; current = status; ctx.emit('network', status); }
    return current;
  }).catch(() => current).finally(() => { inflight = null; });
  return inflight;
}

module.exports = {
  namespace: 'system',
  handlers: {
    /** Returns the cached status once primed; the first call waits for the initial probe. */
    getNetwork: async (ctx) => {
      if (primed) { refresh(ctx); return current; }
      return refresh(ctx);
    }
  },
  start(ctx) {
    refresh(ctx);
    timer = setInterval(() => refresh(ctx), POLL_INTERVAL_MS);
    timer.unref?.();
  },
  stop() { clearInterval(timer); timer = null; }
};
