'use strict';

const { readNetwork } = require('../../../backend/network-status');
const { createGatedPoller, gate } = require('../activity');
const { measurePing, runSpeedTest } = require('../../../backend/net-probe');

const POLL_INTERVAL_MS = 10_000;
const PING_INTERVAL_MS = 10_000;
let poller = null;
let pingPoller = null;
let lastPing = { ms: null, at: 0 };
let speedAbort = null;
let speedState = { state: 'idle' };
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

/** Latency to a public resolver; emitted as `ping` { ms | null, at } on every probe so the header dot stays current. */
async function probePing(ctx, signal) {
  const ms = await measurePing();
  if (signal?.aborted) return lastPing;
  lastPing = { ms, at: Date.now() };
  ctx.emit('ping', lastPing);
  return lastPing;
}

function publishSpeed(ctx, snapshot) {
  speedState = snapshot;
  ctx.emit('speedtest', snapshot);
}

/** Starts the 20 s download test unless one is already running; progress arrives as `speedtest` events. */
function startSpeedTest(ctx) {
  if (speedAbort) return speedState;
  speedAbort = new AbortController();
  const controller = speedAbort;
  publishSpeed(ctx, { state: 'running', elapsedMs: 0, durationMs: 20_000, mbps: 0, averageMbps: 0 });
  void runSpeedTest({ signal: controller.signal, onProgress: (progress) => publishSpeed(ctx, progress) })
    .catch((error) => ({ state: 'error', elapsedMs: 0, durationMs: 20_000, mbps: 0, averageMbps: 0, error: String(error?.message || error) }))
    .then(async (result) => {
      if (speedAbort === controller) speedAbort = null;
      const ping = result.state === 'done' ? await measurePing() : null;
      publishSpeed(ctx, { ...result, ...(ping !== null ? { pingMs: ping } : {}) });
    });
  return speedState;
}

module.exports = {
  namespace: 'system',
  handlers: {
    /** Returns the cached status once primed; the first call waits for the initial probe. */
    getNetwork: async (ctx) => {
      if (primed) { if (!gate.suspended) refresh(ctx); return current; }
      return refresh(ctx);
    },
    getPing: () => lastPing,
    getSpeedTest: () => speedState,
    startSpeedTest: (ctx) => startSpeedTest(ctx),
    cancelSpeedTest: () => { speedAbort?.abort(); return speedState; }
  },
  start(ctx) {
    poller = createGatedPoller({ intervalMs: POLL_INTERVAL_MS, task: (signal) => refresh(ctx, signal) });
    poller.start();
    pingPoller = createGatedPoller({ intervalMs: PING_INTERVAL_MS, task: (signal) => probePing(ctx, signal) });
    pingPoller.start();
  },
  stop() { poller?.stop(); poller = null; pingPoller?.stop(); pingPoller = null; speedAbort?.abort(); }
};
