'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { atomicWrite } = require('../storage');
const { ThemeService, DEFAULT_THEME } = require('../theme-service');
const { BUILTIN_THEMES, contrastRatio, renderThemeCss, GENERATED_START, GENERATED_END } = require('../builtin-themes');
const ThemeEngine = require('../../src/renderer/theme');
const { validateTheme, validateThemeStore } = require('../theme-validation');
const { MediaAssets } = require('../media-assets');
const { ContextArtwork } = require('../context-artwork');
const { listRemoteApps } = require('../../src/main/remote-apps');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRusAAAAASUVORK5CYII=', 'base64');
const custom = (id = 'custom') => ({ ...structuredClone(DEFAULT_THEME), id, name: 'Custom theme' });

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-theme-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const image = path.join(directory, 'cover.png');
  await fs.writeFile(image, png);
  return { directory, image, media: new MediaAssets() };
}

function event(emitter, name) { return once(emitter, name, { signal: AbortSignal.timeout(4000) }); }

test('theme JSON Schema validation rejects invalid colors, toggles, unknown keys and dangling IDs', () => {
  assert.equal(validateTheme(DEFAULT_THEME), DEFAULT_THEME);
  const cases = [
    { ...custom(), palette: { ...DEFAULT_THEME.palette, accent: 'url(javascript:bad)' } },
    { ...custom(), layout: { showHeroCard: 'yes' } },
    { ...custom(), background: { type: 'video', source: '' } },
    { ...custom(), sounds: { enabled: true, volume: 2 } },
    { ...custom(), extensions: { nested: { unsafe: true } } },
    { ...custom(), id: '../escape' }, { ...custom(), name: ' ' }, { ...custom(), unexpected: true }
  ];
  for (const candidate of cases) assert.throws(() => validateTheme(candidate));
  assert.throws(() => validateThemeStore({ version: 1, currentThemeId: 'missing', themes: [custom()] }), /must exist/);
  assert.throws(() => validateThemeStore({ version: 1, currentThemeId: 'custom', themes: [custom(), custom()] }), /unique/);
});

test('theme saves serialize concurrent edits, preserve current selection and persist across restart', async (t) => {
  const { directory, image, media } = await fixture(t);
  const service = new ThemeService(directory, media);
  await service.initialize();
  t.after(() => service.close());
  const changed = [];
  service.on('changed', (state) => changed.push(state));
  const first = { ...custom('first'), background: { type: 'image', source: image }, sounds: { enabled: false, volume: 0.2 } };
  await Promise.all([service.saveCustomTheme(first), service.saveCustomTheme(custom('second'))]);
  assert.equal(service.getAvailableThemes().length, 3 + BUILTIN_THEMES.length);
  assert.equal(service.getCurrentTheme().id, DEFAULT_THEME.id);
  const selected = await service.setTheme('first');
  assert.ok(selected.assets.background.startsWith('vibepollo-media://asset/'));
  assert.deepEqual(selected.unavailableAssets, []);
  assert.equal(changed.length, 3);
  selected.palette.accent = '#000000';
  assert.equal(service.getCurrentTheme().palette.accent, first.palette.accent);
  await assert.rejects(service.setTheme('unknown'), /Unknown/);
  await assert.rejects(service.saveCustomTheme(DEFAULT_THEME), /new ID/);
  await assert.rejects(service.saveCustomTheme({ ...custom('missing'), background: { type: 'image', source: path.join(directory, 'missing.png') } }), /unavailable/);
  const restarted = new ThemeService(directory, new MediaAssets());
  await restarted.initialize();
  t.after(() => restarted.close());
  assert.equal(restarted.getCurrentTheme().id, 'first');
});

test('external atomic edits emit theme state changes; invalid edits retain last known good state', async (t) => {
  const { directory, media } = await fixture(t);
  const service = new ThemeService(directory, media);
  await service.initialize();
  t.after(() => service.close());
  const file = path.join(directory, 'themes.json');
  const document = JSON.parse(await fs.readFile(file, 'utf8'));
  document.themes.push(custom());
  document.currentThemeId = 'custom';
  const changed = event(service, 'changed');
  await atomicWrite(file, JSON.stringify(document));
  assert.equal((await changed)[0].currentTheme.id, 'custom');
  const warning = event(service, 'warning');
  await atomicWrite(file, '{bad JSON');
  await warning;
  assert.equal(service.getCurrentTheme().id, 'custom');
});

test('startup preserves corrupt theme store and reports missing media without preventing startup', async (t) => {
  const { directory, media } = await fixture(t);
  await fs.writeFile(path.join(directory, 'themes.json'), '{bad');
  const service = new ThemeService(directory, media);
  await service.initialize();
  service.close();
  assert.ok((await fs.readdir(directory)).some((name) => name.startsWith('themes.json.corrupt-')));
  const theme = { ...custom(), background: { type: 'video', source: path.join(directory, 'removed.mp4') } };
  await fs.writeFile(path.join(directory, 'themes.json'), JSON.stringify({ version: 1, currentThemeId: theme.id, themes: [theme] }));
  const restored = new ThemeService(directory, media);
  await restored.initialize();
  t.after(() => restored.close());
  assert.deepEqual(restored.getCurrentTheme().unavailableAssets, ['background']);
  assert.equal(restored.getCurrentTheme().assets.background, null);
});

test('media delivery streams byte ranges, suffixes, HEAD and conditional requests without exposing paths', async (t) => {
  const { directory, media } = await fixture(t);
  const video = path.join(directory, 'loop.mp4');
  const file = await fs.open(video, 'w');
  await file.truncate(64 * 1024 * 1024);
  await file.write(Buffer.from('tail'), 0, 4, 64 * 1024 * 1024 - 4);
  await file.close();
  const url = await media.register(video, 'video');
  assert.ok(!url.includes(directory));
  const part = await media.respond(new Request(url, { headers: { Range: 'bytes=-4' } }));
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-length'), '4');
  assert.equal(await part.text(), 'tail');
  const head = await media.respond(new Request(url, { method: 'HEAD' }));
  assert.equal(head.headers.get('content-length'), String(64 * 1024 * 1024));
  assert.equal(await head.text(), '');
  const unchanged = await media.respond(new Request(url, { headers: { 'If-None-Match': head.headers.get('etag') } }));
  assert.equal(unchanged.status, 304);
  const staleRange = await media.respond(new Request(url, { method: 'HEAD', headers: { Range: 'bytes=0-1', 'If-Range': 'stale' } }));
  assert.equal(staleRange.status, 200);
  for (const range of ['bytes=999999999-9999999999', 'bytes=4-2', 'bytes=0-1,3-4', 'bytes=-0']) {
    assert.equal((await media.respond(new Request(url, { headers: { Range: range } }))).status, 416);
  }
  const full = await media.respond(new Request(url));
  const reader = full.body.getReader();
  assert.ok((await reader.read()).value.length <= 256 * 1024);
  await reader.cancel();
});

test('media rejects unregistered URLs, traversal, executable formats and mismatched media kinds', async (t) => {
  const { directory, image, media } = await fixture(t);
  await assert.rejects(media.register(image, 'video'), /supported video/);
  await assert.rejects(media.register('https://example.com/image.png', 'image'), /absolute local/);
  const html = path.join(directory, 'payload.html');
  await fs.writeFile(html, '<script>bad()</script>');
  await assert.rejects(media.register(html, 'image'), /supported image/);
  const url = await media.register(image, 'image');
  assert.equal((await media.respond(new Request(`${url}?path=secret`))).status, 404);
  assert.equal((await media.respond(new Request(url.replace('/asset/', '/other/')))).status, 404);
  assert.equal((await media.respond(new Request('vibepollo-media://asset/not-a-token'))).status, 404);
  assert.equal((await media.respond(new Request(url, { method: 'POST' }))).status, 405);
  await fs.unlink(image);
  assert.equal((await media.respond(new Request(url))).status, 404);
});

test('context artwork warms on a worker and focus lookups remain memory-only below the frame budget', async (t) => {
  const { directory, image, media } = await fixture(t);
  const cache = new ContextArtwork(directory, media);
  await cache.initialize();
  t.after(() => cache.close());
  const changed = event(cache, 'changed');
  await cache.updateTiles([{ id: 'game', hero_image: image }]);
  const entry = (await changed)[0];
  assert.equal(entry.state, 'ready');
  assert.equal(entry.kind, 'hero_image');
  assert.equal(await (await media.respond(new Request(entry.url))).arrayBuffer().then((bytes) => Buffer.from(bytes).equals(png)), true);
  assert.equal(cache.getAppBackground('unknown').state, 'missing');
  const timings = [];
  for (let index = 0; index < 10000; index++) {
    const start = performance.now();
    cache.getAppBackground('game');
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.floor(timings.length * 0.95)];
  t.diagnostic(`Warm in-memory artwork lookup p95: ${p95.toFixed(4)} ms (10,000 lookups)`);
  assert.ok(p95 < 16);
  await fs.unlink(image);
  const restarted = new ContextArtwork(directory, new MediaAssets());
  await restarted.initialize();
  t.after(() => restarted.close());
  await restarted.updateTiles([{ id: 'game', hero_image: image }]);
  assert.equal(restarted.getAppBackground('game').state, 'ready');
});

test('cold and missing artwork returns immediately, stale results cannot replace a new focused app source', async (t) => {
  const { directory, image, media } = await fixture(t);
  const cache = new ContextArtwork(directory, media);
  await cache.initialize();
  t.after(() => cache.close());
  await cache.updateTiles([{ id: 'game', fanart: image }]);
  await cache.updateTiles([{ id: 'game' }]);
  assert.equal(cache.getAppBackground('game').state, 'missing');
  const failure = event(cache, 'changed');
  await cache.updateTiles([{ id: 'missing', fanart: path.join(directory, 'not-found.png') }]);
  assert.equal((await failure)[0].state, 'missing');
  assert.equal(cache.getAppBackground('game').state, 'missing');
});

test('remote host cache preserves contextual metadata without preserving executable cache fields', async (t) => {
  const { directory } = await fixture(t);
  const file = path.join(directory, 'remote.json');
  await fs.writeFile(file, JSON.stringify({ host: 'pc', tiles: [{ id: 'remote:pc:1', name: 'Game', icon: '', hero_image: 'https://pc/hero.png', fanart: 'https://pc/fanart.png', env: { unsafe: 'value' } }] }));
  const result = await listRemoteApps({ enabled: true, host: 'pc' }, file, { cacheOnly: true });
  assert.equal(result.tiles[0].hero_image, 'https://pc/hero.png');
  assert.equal(result.tiles[0].fanart, 'https://pc/fanart.png');
  assert.equal(result.tiles[0].env, undefined);
});

test('at least 40 built-in themes validate, have unique IDs and distinct palettes', () => {
  assert.ok(BUILTIN_THEMES.length >= 40);
  const ids = BUILTIN_THEMES.map((theme) => theme.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(DEFAULT_THEME.id));
  const signatures = new Set();
  for (const theme of BUILTIN_THEMES) {
    validateTheme(structuredClone(theme));
    signatures.add(Object.values(theme.palette).join('|'));
  }
  assert.equal(signatures.size, BUILTIN_THEMES.length);
  validateThemeStore({ version: 1, currentThemeId: DEFAULT_THEME.id, themes: [DEFAULT_THEME, ...structuredClone(BUILTIN_THEMES)] });
});

test('built-in themes keep readable text and a visible accent', () => {
  for (const { id, palette } of BUILTIN_THEMES) {
    assert.ok(contrastRatio(palette.text, palette.background) >= 7, id + ' text on background');
    assert.ok(contrastRatio(palette.text, palette.surface) >= 4.5, id + ' text on surface');
    assert.ok(contrastRatio(palette.mutedText, palette.surface) >= 4.5, id + ' muted text on surface');
    assert.ok(contrastRatio(palette.accent, palette.background) >= 3, id + ' accent on background');
    assert.ok(contrastRatio(palette.accent, palette.surface) >= 2.2, id + ' accent on surface');
  }
});

test('renderer presets match backend themes and theme.css carries every generated token block', async () => {
  const css = (await fs.readFile(path.join(__dirname, '../../src/renderer/theme.css'), 'utf8')).replace(/\r\n/g, '\n');
  const start = css.indexOf(GENERATED_START);
  const end = css.indexOf(GENERATED_END);
  assert.ok(start >= 0 && end > start, 'generated block markers present');
  assert.equal(css.slice(start, end + GENERATED_END.length), renderThemeCss(), 'run renderThemeCss() to refresh theme.css');
  assert.equal(ThemeEngine.PRESETS.length, BUILTIN_THEMES.length);
  for (const preset of ThemeEngine.PRESETS) {
    assert.ok(css.includes('[data-theme="' + preset.id + '"]'), preset.id + ' has a token block');
    assert.ok(BUILTIN_THEMES.some((theme) => theme.extensions.uiPreset === preset.id));
    assert.equal(preset.swatch.length, 4);
    assert.equal(ThemeEngine.resolve({ preset: preset.id }).preset, preset.id);
  }
});

test('stores created before the new themes gain missing built-ins without losing custom edits', async (t) => {
  const { directory, media } = await fixture(t);
  const edited = { ...custom(BUILTIN_THEMES[0].id), name: 'My edit' };
  await fs.writeFile(path.join(directory, 'themes.json'), JSON.stringify({ version: 1, currentThemeId: DEFAULT_THEME.id, themes: [DEFAULT_THEME, edited] }));
  const service = new ThemeService(directory, media);
  await service.initialize();
  t.after(() => service.close());
  const themes = service.getAvailableThemes();
  assert.equal(themes.length, 1 + BUILTIN_THEMES.length);
  assert.equal(themes.find((theme) => theme.id === edited.id).name, 'My edit');
});

test('fonts: unique ids, every themed fontId exists, every bundled family has @font-face and files are woff2', async () => {
  const fontsDir = path.join(__dirname, '../../src/renderer');
  const css = await fs.readFile(path.join(fontsDir, 'fonts.css'), 'utf8');
  const ids = ThemeEngine.FONTS.map((font) => font.id);
  assert.equal(new Set(ids).size, ids.length, 'unique font ids');
  assert.ok(ids.length >= 15);
  for (const font of ThemeEngine.FONTS) {
    assert.ok(font.stack && font.name && font.category, font.id + ' is complete');
    if (font.category !== 'system') assert.ok(css.includes('font-family: "' + font.name + '"'), font.id + ' has @font-face');
  }
  for (const url of css.matchAll(/url\("([^"]+)"\)/g)) {
    const bytes = await fs.readFile(path.join(fontsDir, url[1]));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', url[1] + ' is woff2');
  }
  for (const palette of ThemeEngine.PALETTES) assert.ok(ids.includes(palette.fontId), palette.id + ' fontId known');
  for (const theme of BUILTIN_THEMES) assert.ok(ids.includes(theme.fontId), theme.id + ' backend fontId known');
});

test('applyFont follows the theme or overrides it, and custom themes reject unknown fonts', () => {
  const { validateTheme } = require('../theme-validation');
  const style = new Map();
  const element = { style: { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k) } };
  assert.equal(ThemeEngine.applyFont(element, 'orbitron'), 'orbitron');
  assert.match(style.get('--font-ui'), /Orbitron/);
  assert.equal(ThemeEngine.applyFont(element, 'theme'), 'theme');
  assert.equal(style.size, 0);
  assert.equal(ThemeEngine.applyFont(element, 'nope'), 'theme');
  const base = { ...BUILTIN_THEMES[0], id: 'custom-1' };
  assert.doesNotThrow(() => validateTheme({ ...base, fontId: 'lora' }));
  assert.throws(() => validateTheme({ ...base, fontId: 'comic-sans' }), /fontId/);
});
