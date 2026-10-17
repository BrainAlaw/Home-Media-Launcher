'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { fileURLToPath } = require('node:url');
const presets = require('../backend/web-presets');
const resolverModule = require('../backend/icon-resolver');
const tileArt = require('../backend/tile-art');
const steam = require('../backend/steamgriddb');
const AssetUrl = require('../src/renderer/asset-url');
const { bundledTile } = require('../scripts/build-preset-tiles');

const { createIconResolver } = resolverModule;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'icons-art-'));

/** Solid RGBA PNG (CRC fields are zero: the decoder under test does not verify them). */
function solidPng(size, [red, green, blue, alpha = 255]) {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x += 1) row.set([red, green, blue, alpha], 1 + x * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (name, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(name, 4);
    data.copy(out, 8);
    return out;
  };
  const pixels = zlib.deflateSync(Buffer.concat(Array(size).fill(row)));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

test('seeded websites store install-independent tokens and legacy absolute icons migrate', () => {
  const site = presets.presetToWebsite(presets.getPreset('netflix'));
  assert.equal(site.icon, 'preset:netflix');
  for (const entry of presets.firstRunWebsites()) assert.match(entry.icon, /^preset:[a-z0-9-]+$/);
  const legacy = [
    { id: 'preset:netflix', name: 'Netflix', url: 'https://www.netflix.com/', icon: 'file:///D:/Github%20Repos/Home-Media-Launcher/src/renderer/icons/presets/netflix.svg' },
    { id: 'mine', name: 'Mine', url: 'https://x.test/', icon: 'file:///C:/custom/netflix.png' },
    { id: 'preset:zzz', name: 'Z', url: 'https://z.test/', icon: 'file:///old/icons/presets/zzz.svg' }
  ];
  const migrated = presets.migratePresetIcons(legacy);
  assert.equal(migrated[0].icon, 'preset:netflix');
  assert.equal(migrated[1].icon, 'file:///C:/custom/netflix.png');
  assert.equal(migrated[2].icon, legacy[2].icon);
  assert.equal(presets.migratePresetIcons(migrated), migrated);
  assert.equal(presets.presetIdFromIcon('/home/u/app/src/renderer/icons/presets/plex.svg'), 'plex');
});

test('renderer resolves preset tokens and legacy file URLs, honouring the fetched tile art map', () => {
  const legacy = 'file:///D:/Github%20Repos/Home-Media-Launcher/src/renderer/icons/presets/netflix.svg';
  assert.equal(AssetUrl.assetUrl('preset:netflix'), 'icons/presets/netflix.svg');
  assert.equal(AssetUrl.assetUrl(legacy), 'icons/presets/netflix.svg');
  assert.ok(AssetUrl.isLoadableImage('preset:netflix'));
  assert.equal(AssetUrl.assetUrl('file:///C:/mine/netflix.png'), 'file:///C:/mine/netflix.png');
  AssetUrl.setPresetIcons({ netflix: 'file:///cache/presets/netflix.svg', bad: 'https://evil.test/x.svg' });
  assert.equal(AssetUrl.assetUrl('preset:netflix'), 'file:///cache/presets/netflix.svg');
  assert.equal(AssetUrl.assetUrl('preset:bad'), 'icons/presets/bad.svg');
});

test('tile art: PNG sampling, composition and monograms', () => {
  const decoded = tileArt.decodePng(solidPng(8, [200, 30, 20]));
  assert.equal(decoded.width, 8);
  assert.deepEqual(Array.from(decoded.data.slice(0, 4)), [200, 30, 20, 255]);
  assert.match(tileArt.analyseImage(decoded).color, /^#c81e14$/i);
  assert.equal(tileArt.analyseImage(tileArt.decodePng(solidPng(8, [128, 128, 128]))).color, null);
  assert.equal(tileArt.analyseImage(tileArt.decodePng(solidPng(8, [0, 0, 0, 0]))).transparent, true);
  assert.equal(tileArt.decodePng(Buffer.from('nope')), null);
  assert.equal(tileArt.monogramText('Prime Video'), 'PV');
  assert.equal(tileArt.monogramText('Zed', 'q'), 'q');
  const svg = tileArt.composeTile({ name: 'X', color: '#336699', iconDataUrl: 'data:image/png;base64,AAAA' });
  assert.match(svg, /viewBox="0 0 1280 720"/);
  assert.match(svg, /<image /);
  assert.ok(resolverModule.sanitizeSvg(Buffer.from(svg)), 'composed tile passes the SVG sanitiser');
  assert.doesNotMatch(tileArt.composeTile({ name: 'X' }), /<image /);
});

test('bundled fallback tiles are generated monograms (run node scripts/build-preset-tiles.js after changes)', () => {
  for (const preset of presets.listPresets()) {
    assert.equal(fs.readFileSync(fileURLToPath(preset.icon), 'utf8').trim(), bundledTile(preset.id), preset.id);
  }
});

test('resolvePresetIcon: fetches the service icon, composes a tile, caches it; falls back to the bundled tile', async () => {
  const requested = [];
  const fetchSite = async (url) => {
    requested.push(url);
    if (url === 'https://www.netflix.com/') return { url, body: Buffer.from('<link rel="apple-touch-icon" href="/a.png"><link rel="icon" href="/small.png">') };
    if (url === 'https://www.netflix.com/a.png') return { url, body: solidPng(180, [229, 9, 20]) };
    if (url.endsWith('/small.png')) return { url, body: solidPng(32, [0, 0, 0]) };
    if (url.startsWith('https://www.youtube.com/')) return { url, body: Buffer.from('<html>blocked</html>') };
    throw new Error('404');
  };
  const resolver = createIconResolver({ userData: tmp(), fetchSite });
  const first = await resolver.resolvePresetIcon('netflix');
  const file = fileURLToPath(first);
  assert.ok(file.includes('icon-cache'));
  const svg = fs.readFileSync(file, 'utf8');
  assert.match(svg, /data:image\/png;base64,/);
  assert.match(svg, /#e50914/i);
  const count = requested.length;
  assert.equal(await resolver.resolvePresetIcon('netflix'), first);
  assert.equal(requested.length, count, 'second call is served from cache');
  const fallback = await resolver.resolvePresetIcon('youtube');
  assert.equal(fallback, presets.getPreset('youtube').icon);
  assert.deepEqual(await resolver.presetIconMap(['netflix', 'youtube', 'nope']), { netflix: first, youtube: fallback });
  await assert.rejects(resolver.resolvePresetIcon('nope'));
  assert.deepEqual(await resolver.resolve({ kind: 'website', name: 'Netflix', url: 'https://www.netflix.com/browse' }), { source: 'preset', url: first });
  await resolver.prune();
  assert.ok(fs.existsSync(file));
});

test('steamgriddb: icons rank square >= 256 first; small icons fall back to a logo on a gradient', async () => {
  const ranked = steam.rankIcons([{ width: 64, height: 64 }, { width: 512, height: 256 }, { width: 256, height: 256 }, { width: 1024, height: 1024 }]);
  assert.deepEqual(ranked.map((entry) => entry.width), [1024, 256, 512, 64]);
  const json = (data) => ({ body: Buffer.from(JSON.stringify({ success: true, data })) });
  const requestBuffer = async (url) => {
    if (url.includes('/search/autocomplete/')) return json([{ id: 9, name: 'Doom' }]);
    if (url.includes('/icons/game/9')) return json([{ id: 1, url: 'https://cdn2.steamgriddb.com/icon/small.png', width: 64, height: 64 }]);
    if (url.includes('/logos/game/9')) return json([{ id: 2, url: 'https://cdn2.steamgriddb.com/logo/l.png', width: 800, height: 300 }]);
    if (url.endsWith('/logo/l.png')) return { body: solidPng(16, [250, 100, 0]) };
    throw new Error(`unexpected ${url}`);
  };
  const resolver = createIconResolver({ userData: tmp(), secrets: { steamGridDbKey: 'K' }, requestBuffer });
  const result = await resolver.resolve({ kind: 'game', name: 'Doom', art: 'icon' });
  assert.equal(result.source, 'steamgriddb');
  const svg = fs.readFileSync(fileURLToPath(result.url), 'utf8');
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.match(svg, /#fa6400/i);
});
