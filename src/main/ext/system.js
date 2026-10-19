'use strict';

const { readNetwork } = require('../../../backend/network-status');
const { createGatedPoller, gate } = require('../activity');
const { measurePing, runSpeedTest, runUploadTest, SPEED_DURATION_MS, UPLOAD_DURATION_MS } = require('../../../backend/net-probe');

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

/**
 * One speed cycle: download for SPEED_DURATION_MS, then upload for UPLOAD_DURATION_MS. Every snapshot carries `phase`
 * ('download' | 'upload' | 'done') and the Mbps measured so far (`downMbps`, `upMbps`). Abort between or inside phases stops it.
 */
async function runSpeedCycle(ctx, signal) {
  const download = await runSpeedTest({
    signal,
    onProgress: (progress) => publishSpeed(ctx, { ...progress, phase: 'download', downMbps: 0, upMbps: 0 })
  });
  const downMbps = download.averageMbps ?? 0;
  if (download.state !== 'done' || signal.aborted) return { ...download, phase: 'download', downMbps, upMbps: 0 };
  const upload = await runUploadTest({
    durationMs: UPLOAD_DURATION_MS,
    signal,
    onProgress: (progress) => publishSpeed(ctx, { ...progress, phase: 'upload', downMbps, upMbps: 0 })
  });
  return { ...upload, phase: 'done', downMbps, upMbps: upload.averageMbps ?? 0 };
}

/** Starts the download + upload cycle unless one is already running; progress arrives as `speedtest` events. */
function startSpeedTest(ctx) {
  if (speedAbort) return speedState;
  speedAbort = new AbortController();
  const controller = speedAbort;
  publishSpeed(ctx, {
    state: 'running', phase: 'download', elapsedMs: 0, durationMs: SPEED_DURATION_MS, mbps: 0, averageMbps: 0, downMbps: 0, upMbps: 0
  });
  void runSpeedCycle(ctx, controller.signal)
    .catch((error) => ({
      state: 'error', phase: 'download', elapsedMs: 0, durationMs: SPEED_DURATION_MS, mbps: 0, averageMbps: 0, downMbps: 0, upMbps: 0,
      error: String(error?.message || error)
    }))
    .then(async (result) => {
      if (speedAbort === controller) speedAbort = null;
      const done = result.state === 'done';
      const ping = done ? await measurePing() : null;
      // `doneAt` lets the renderer hold the result for a fixed time and fade it out, even after a reload.
      publishSpeed(ctx, {
        ...result,
        phase: done ? 'done' : result.phase,
        ...(done ? { doneAt: Date.now() } : {}),
        ...(ping !== null ? { pingMs: ping } : {})
      });
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
