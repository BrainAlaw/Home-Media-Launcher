'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { SlideshowCache } = require('../slideshow-cache');
const { MediaAssets } = require('../media-assets');
const { NavigationHints } = require('../navigation-hints');
const { MenuIndicators } = require('../menu-indicators');
const { resolveMenu, validateMenu } = require('../menu-config');
const { validateConfig } = require('../../src/main/config');

async function fixture(t, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-slides-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const media = new MediaAssets();
  const cache = new SlideshowCache(media, options);
  media.setMemoryCache(cache);
  t.after(() => cache.close());
  const assets = [];
  for (let index = 0; index < 8; index++) {
    const source = path.join(directory, `slide-${index}.webp`);
    await fs.writeFile(source, Buffer.alloc(128, index));
    assets.push({ type: 'image', source });
  }
  return { directory, media, cache, assets };
}

function settled(cache) { return once(cache, 'changed', { signal: AbortSignal.timeout(6000) }); }

test('advanced menu definitions are independent of game tile schemas and preserve legacy defaults', () => {
  const tile = { id: 'game', name: 'Game', command: 'game.exe', args: [] };
  const menu = resolveMenu();
  menu.layout = 'side-dock';
  menu.groups[0].items.push({ id: 'racing', label: 'Racing', action: 'category', category: 'Racing' });
  const config = { menu, rows: [{ title: 'Games', tiles: [tile] }] };
  assert.equal(validateConfig(config).rows[0].tiles[0], tile);
  assert.equal(resolveMenu().layout, 'top-bar');
  for (const bad of [
    { ...menu, layout: 'arbitrary' },
    { ...menu, slideshow: { enabled: true, lookAhead: 6, assets: [] } },
    { ...menu, slideshow: { enabled: true, lookAhead: 3.5, assets: [] } },
    { ...menu, groups: [{ id: 'main', label: 'Main', items: [{ id: 'racing', label: 'Racing', action: 'category' }] }] },
    { ...menu, groups: [menu.groups[0], menu.groups[0]] }
  ]) assert.throws(() => validateMenu(bad));
});

test('current plus next five slides are resident and fully cached reads survive source removal', async (t) => {
  const { media, cache, assets } = await fixture(t);
  const ready = settled(cache);
  await cache.configure({ enabled: true, lookAhead: 5, assets });
  await ready;
  const state = cache.state();
  assert.equal(state.slides.filter((slide) => slide.memory === 'full').length, 6);
  for (let index = 0; index < 6; index++) await fs.unlink(assets[index].source);
  for (let index = 0; index < 6; index++) {
    const response = await media.respond(new Request(state.slides[index].url));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.alloc(128, index));
  }
  assert.equal(cache.state().cachedBytes, 6 * 128);
  const head = await media.respond(new Request(state.slides[0].url, { method: 'HEAD' }));
  assert.equal(head.headers.get('content-length'), '128');
});

test('rolling windows wrap, cancel obsolete prefetches and evict unused memory', async (t) => {
  const { cache, assets } = await fixture(t);
  const ready = settled(cache);
  await cache.configure({ enabled: true, lookAhead: 3, assets });
  await ready;
  const next = settled(cache);
  cache.setPosition(4);
  cache.setPosition(7);
  await next;
  const state = cache.state();
  assert.equal(state.currentIndex, 7);
  assert.deepEqual(state.slides.map((slide, index) => slide.memory === 'full' ? index : null).filter((index) => index !== null), [0, 1, 2, 7]);
  assert.equal(state.cachedBytes, 4 * 128);
  assert.throws(() => cache.setPosition(-1), /Invalid/);
  assert.throws(() => cache.setPosition(100), /Invalid/);
});

test('prefetch limits resident bytes and reports budget fallback instead of unbounded allocations', async (t) => {
  const { cache, assets } = await fixture(t, { budget: 512, fullLimit: 256, headBytes: 128, tailBytes: 32 });
  const ready = settled(cache);
  await cache.configure({ enabled: true, lookAhead: 5, assets });
  await ready;
  const state = cache.state();
  assert.ok(state.cachedBytes <= 512);
  assert.equal(state.slides[0].memory, 'full');
  assert.equal(state.slides.filter((slide) => slide.memory === 'unavailable').length, 2);
});

test('large videos serve cached head and tail without disk while middle ranges stream on demand', async (t) => {
  const { directory, media, cache } = await fixture(t, { budget: 256 * 1024, fullLimit: 64 * 1024, headBytes: 64 * 1024, tailBytes: 4096 });
  const source = path.join(directory, 'loop.mp4');
  const content = Buffer.alloc(1024 * 1024, 42);
  content.write('head', 0); content.write('tail', content.length - 4);
  await fs.writeFile(source, content);
  const ready = settled(cache);
  await cache.configure({ enabled: true, lookAhead: 3, assets: [{ type: 'video', source }] });
  await ready;
  const slide = cache.state().slides[0];
  assert.equal(slide.memory, 'partial');
  assert.equal(cache.state().cachedBytes, 64 * 1024 + 4096);
  const middle = await media.respond(new Request(slide.url, { headers: { Range: 'bytes=100000-100010' } }));
  assert.deepEqual(Buffer.from(await middle.arrayBuffer()), content.subarray(100000, 100011));
  const full = await media.respond(new Request(slide.url));
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), content);
  const abort = new AbortController();
  const stream = await media.respond(new Request(slide.url, { signal: abort.signal }));
  const reader = stream.body.getReader();
  await reader.read();
  await reader.cancel();
  await fs.unlink(source);
  assert.equal(await (await media.respond(new Request(slide.url, { headers: { Range: 'bytes=0-3' } }))).text(), 'head');
  assert.equal(await (await media.respond(new Request(slide.url, { headers: { Range: 'bytes=-4' } }))).text(), 'tail');
});

test('rapid hints coalesce latest focus and slideshow patches without synchronous callbacks', async () => {
  const received = [];
  const hints = new NavigationHints((hint) => received.push(hint));
  for (let index = 0; index < 1000; index++) hints.push({ appId: `game-${index}` });
  hints.push({ slideshowIndex: 3 });
  assert.equal(received.length, 0);
  await new Promise(setImmediate);
  assert.deepEqual(received, [{ appId: 'game-999', slideshowIndex: 3 }]);
  assert.equal(hints.push({ slideshowIndex: -1 }), false);
  assert.equal(hints.push({ command: 'unsafe' }), false);
  hints.push({ appId: 'cancelled' }); hints.close();
  await new Promise(setImmediate);
  assert.equal(received.length, 1);
});

test('system and Moonlight snapshots never perform work on indicator reads', async (t) => {
  const indicators = new MenuIndicators();
  t.after(() => indicators.close());
  const initial = indicators.get();
  assert.equal(initial.system.sampledAt, null);
  indicators.start();
  indicators.updateMoonlight({ status: 'cached', host: 'gaming-pc', message: 'gaming-pc offline', error: '', warning: '', updatedAt: '' });
  const timings = [];
  for (let index = 0; index < 1000; index++) {
    const started = performance.now();
    assert.equal(indicators.get().moonlight.status, 'cached');
    timings.push(performance.now() - started);
  }
  const copy = indicators.get(); copy.moonlight.host = 'changed';
  assert.equal(indicators.get().moonlight.host, 'gaming-pc');
  timings.sort((a, b) => a - b);
  t.diagnostic(`Cached indicator lookup p95: ${timings[950].toFixed(4)} ms while system sampling runs independently`);
  assert.ok(timings[950] < 16);
  const sampled = await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('System sampling timed out')), 6000);
    const listener = (snapshot) => {
      if (!snapshot.system.sampledAt) return;
      clearTimeout(deadline);
      indicators.removeListener('changed', listener);
      resolve(snapshot);
    };
    indicators.on('changed', listener);
    listener(indicators.get());
  });
  assert.equal(typeof sampled.system.sampledAt, 'string');
  assert.equal(typeof sampled.system.network.interfaceCount, 'number');
});

test('slideshow cache respawns its worker after a crash', async (t) => {
  const { cache, media, assets } = await fixture(t);
  await cache.configure({ enabled: true, lookAhead: 1, assets });
  await settled(cache);
  await cache.worker.terminate();
  assert.equal(cache.worker, null);
  const next = settled(cache);
  cache.setPosition(2);
  assert.ok(cache.worker);
  await next;
  assert.ok(cache.state().cachedBytes > 0);
  assert.ok(media);
});

test('context artwork recovers from a worker crash and prunes evicted files', async (t) => {
  const { ContextArtwork } = require('../context-artwork');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-ctx-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const artwork = new ContextArtwork(directory, new MediaAssets());
  await artwork.initialize();
  t.after(() => artwork.close());
  const png = (n) => `data:image/png;base64,${Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, n % 251), Buffer.from([n >> 8, n & 255])]).toString('base64')}`;
  assert.ok(await artwork.download(png(1)));
  await artwork.worker.terminate();
  assert.ok(await artwork.download(png(2)), 'download works after respawn');
  for (let batch = 0; batch < 6; batch++) {
    await Promise.all(Array.from({ length: 200 }, (_, i) => artwork.download(png(10 + batch * 200 + i))));
  }
  assert.ok(Object.keys(artwork.manifest).length <= 1024, 'in-memory manifest is bounded');
  const files = await fs.readdir(path.join(directory, 'context-artwork'));
  assert.ok(files.length <= 1030, `cache files bounded, found ${files.length}`);
});
