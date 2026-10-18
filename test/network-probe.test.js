'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpeedMeter, toMbps, tcpPing, runSpeedTest } = require('../backend/net-probe');
const { pingTone, formatMbps, networkLine } = require('../src/renderer/status-widgets');
const { mapForYou } = require('../backend/spotify/mappers');
const VM = require('../src/renderer/media-view-model');
const { composeTile } = require('../backend/tile-art');

test('toMbps converts bytes and milliseconds', () => {
  assert.equal(toMbps(12_500_000, 1000), 100);
  assert.equal(toMbps(1, 0), 0);
});

test('speed meter reports the average and a sliding live figure', () => {
  const meter = createSpeedMeter(0);
  for (let at = 100; at <= 4000; at += 100) meter.add(125_000, at);
  const snap = meter.snapshot(4000);
  assert.equal(Math.round(snap.averageMbps), 10);
  assert.equal(Math.round(snap.liveMbps), 10);
});

test('tcpPing resolves null on error and never rejects', async () => {
  const { EventEmitter } = require('node:events');
  const socket = Object.assign(new EventEmitter(), { setTimeout() {}, destroy() {} });
  const promise = tcpPing({ host: 'x', port: 1 }, { connect: () => socket });
  socket.emit('error', new Error('refused'));
  assert.equal(await promise, null);
});

test('runSpeedTest finishes on its own and a cancel resolves as cancelled', async () => {
  const body = () => ({ getReader: () => { let sent = 0; return { read: async () => { await new Promise((resolve) => { setImmediate(resolve); }); return sent++ < 3 ? { done: false, value: new Uint8Array(1000) } : { done: true }; } }; } });
  const fetchOnce = async () => ({ ok: true, status: 200, body: body() });
  const controller = new AbortController();
  const finished = runSpeedTest({ durationMs: 60, fetch: fetchOnce });
  assert.equal((await finished).state, 'done');
  const cancelled = runSpeedTest({ durationMs: 5000, signal: controller.signal, fetch: fetchOnce });
  controller.abort();
  assert.equal((await cancelled).state, 'cancelled');
});

test('ping tone and network line wording', () => {
  assert.equal(pingTone(null), 'idle');
  assert.equal(pingTone({ ms: null }), 'off');
  assert.equal(pingTone({ ms: 20 }), 'on');
  assert.equal(pingTone({ ms: 90 }), 'warn');
  assert.equal(pingTone({ ms: 300 }), 'off');
  assert.equal(formatMbps(412.6), '413');
  assert.equal(formatMbps(9.44), '9.4');
  assert.equal(networkLine({ detail: '192.168.0.2', ping: { ms: 14 } }), '192.168.0.2 · ping 14 ms');
  assert.equal(networkLine({ detail: '192.168.0.2', ping: { ms: null } }), '192.168.0.2 · no internet');
  assert.match(networkLine({ detail: '', speed: { state: 'running', mbps: 120, elapsedMs: 5000, durationMs: 20000 } }), /Testing… 120 Mbps · 15s left/);
  assert.equal(networkLine({ detail: '', speed: { state: 'done', averageMbps: 480, pingMs: 12 } }), '\u2193 480 Mbps · ping 12 ms');
});

test('For you shelves keep Spotify-owned playlists, dedupe recents and skip empty shelves', () => {
  const playlist = (id, owner) => ({ id, uri: `spotify:playlist:${id}`, name: id, owner: { id: owner, display_name: owner } });
  const track = (id) => ({ id, uri: `spotify:track:${id}`, name: id, artists: [{ name: 'A' }], album: { name: 'B', images: [] }, duration_ms: 1000 });
  const mapped = mapForYou({
    playlists: { items: [playlist('mix1', 'spotify'), playlist('mine', 'me')] },
    recent: { items: [{ track: track('t1') }, { track: track('t1') }, { track: track('t2') }] }
  });
  assert.deepEqual(mapped.madeForYou.map((item) => item.id), ['mix1']);
  assert.deepEqual(mapped.recent.map((item) => item.id), ['t1', 't2']);
  const sections = VM.mapForYouResult(mapped);
  assert.deepEqual(sections.map((section) => section.id), ['made', 'recent']);
  assert.equal(sections[0].items[0].direct, true);
});

test('portrait tiles are 2:3 and show the poster edge to edge', () => {
  const svg = composeTile({ name: 'Tekken 6', portrait: true, posterDataUrl: 'data:image/png;base64,AAAA' });
  assert.match(svg, /viewBox="0 0 600 900"/);
  assert.match(svg, /<image [^>]*x="0" y="0" width="600" height="900"/);
});
