'use strict';

const net = require('node:net');

/** Public resolvers that accept TCP on 443; the first one that answers decides the latency. */
const PING_TARGETS = Object.freeze([{ host: '8.8.8.8', port: 443 }, { host: '8.8.4.4', port: 443 }]);
const PING_TIMEOUT_MS = 2000;

const SPEED_URL = 'https://speed.cloudflare.com/__down';
const SPEED_CHUNK_BYTES = 50_000_000;
const SPEED_STREAMS = 4;
const SPEED_DURATION_MS = 20_000;
const SPEED_TICK_MS = 250;
/** Window for the live (instantaneous) figure shown while the test runs. */
const LIVE_WINDOW_MS = 1500;

/** TCP connect time to `host:port` in whole milliseconds, or null when it fails or times out. Never rejects. */
function tcpPing({ host, port }, { timeoutMs = PING_TIMEOUT_MS, connect = net.connect, now = () => performance.now() } = {}) {
  return new Promise((resolve) => {
    const started = now();
    let settled = false;
    const socket = connect({ host, port });
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(Math.max(1, Math.round(now() - started))));
    socket.once('timeout', () => done(null));
    socket.once('error', () => done(null));
  });
}

/** Latency to the first reachable target, or null when none answers. */
async function measurePing(options) {
  for (const target of PING_TARGETS) {
    const ms = await tcpPing(target, options);
    if (ms !== null) return ms;
  }
  return null;
}

/** Megabits per second for `bytes` transferred in `ms`. */
const toMbps = (bytes, ms) => (ms > 0 ? (bytes * 8) / (ms / 1000) / 1_000_000 : 0);

/**
 * Accumulates downloaded bytes and reports both the average since the start and a short sliding-window figure.
 * Pure: time is always passed in, so it is unit tested without a network.
 */
function createSpeedMeter(startMs) {
  const samples = [{ at: startMs, bytes: 0 }];
  let total = 0;
  return {
    add(bytes, at) { total += bytes; samples.push({ at, bytes: total }); },
    snapshot(at) {
      const cutoff = at - LIVE_WINDOW_MS;
      let anchor = samples[0];
      for (const sample of samples) { if (sample.at <= cutoff) anchor = sample; else break; }
      return { bytes: total, averageMbps: toMbps(total, at - startMs), liveMbps: toMbps(total - anchor.bytes, Math.max(1, at - Math.max(anchor.at, startMs))) };
    }
  };
}

/**
 * Downloads from several parallel streams for `durationMs` and reports progress. Resolves with the final result;
 * an abort resolves with `{ state: 'cancelled' }`. Nothing is stored and no identifier is sent.
 * @param {{ durationMs?: number, signal?: AbortSignal, onProgress?: (p: object) => void, fetch?: typeof fetch, now?: () => number }} [options]
 */
async function runSpeedTest({ durationMs = SPEED_DURATION_MS, signal, onProgress = () => {}, fetch: fetchImpl = globalThis.fetch, now = () => performance.now() } = {}) {
  const started = now();
  const meter = createSpeedMeter(started);
  const stop = new AbortController();
  const abortAll = () => stop.abort();
  signal?.addEventListener('abort', abortAll, { once: true });
  const deadline = setTimeout(abortAll, durationMs);
  const tick = setInterval(() => {
    const at = now();
    const snap = meter.snapshot(at);
    onProgress({ state: 'running', elapsedMs: Math.min(durationMs, at - started), durationMs, mbps: snap.liveMbps, averageMbps: snap.averageMbps });
  }, SPEED_TICK_MS);
  let failure = null;

  async function stream() {
    while (!stop.signal.aborted) {
      const response = await fetchImpl(`${SPEED_URL}?bytes=${SPEED_CHUNK_BYTES}`, { signal: stop.signal, cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error(`Speed test server answered HTTP ${response.status}`);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        meter.add(value.byteLength, now());
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: SPEED_STREAMS }, () => stream().catch((error) => {
      if (!stop.signal.aborted) { failure = error; abortAll(); }
    })));
  } finally {
    clearTimeout(deadline);
    clearInterval(tick);
    signal?.removeEventListener('abort', abortAll);
  }
  const ended = now();
  const snap = meter.snapshot(ended);
  if (signal?.aborted) return { state: 'cancelled', elapsedMs: ended - started, durationMs, mbps: 0, averageMbps: snap.averageMbps };
  if (failure && snap.bytes === 0) return { state: 'error', elapsedMs: ended - started, durationMs, mbps: 0, averageMbps: 0, error: String(failure.message || failure) };
  return { state: 'done', elapsedMs: ended - started, durationMs, mbps: snap.averageMbps, averageMbps: snap.averageMbps };
}

module.exports = { tcpPing, measurePing, createSpeedMeter, runSpeedTest, toMbps, PING_TARGETS, SPEED_DURATION_MS };
