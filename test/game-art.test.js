'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { fileURLToPath } = require('node:url');
const { createIconResolver } = require('../backend/icon-resolver');
const tileArt = require('../backend/tile-art');
const { parseApiApps, listRemoteApps } = require('../src/main/remote-apps');
const icons = require('../src/main/ext/icons');
const AssetUrl = require('../src/renderer/asset-url');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'game-art-'));

function solidPng(width, height, [red, green, blue]) {
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) row.set([red, green, blue, 255], 1 + x * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const chunk = (name, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(name, 4);
    data.copy(out, 8);
    return out;
  };
  const pixels = zlib.deflateSync(Buffer.concat(Array(height).fill(row)));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

const json = (data) => ({ body: Buffer.from(JSON.stringify({ success: true, data })) });

test('composeTile: monogram mark is 46% of the height; poster and hero variants embed their image', () => {
  const mono = tileArt.composeTile({ name: 'Prime Video', mono: 'PV' });
  assert.match(mono, />PV</);
  assert.match(mono, /font-weight="800"/);
  const poster = tileArt.composeTile({ name: 'Doom', posterDataUrl: 'data:image/png;base64,AAAA', posterAspect: 2 / 3 });
  assert.match(poster, /<image [^>]*height="619"/);
  assert.deepEqual(tileArt.posterBox(1280, 720, 2 / 3), { x: 434, y: 51, width: 413, height: 619 });
  assert.match(tileArt.composeTile({ name: 'Doom', heroDataUrl: 'data:image/png;base64,AAAA' }), /preserveAspectRatio="xMidYMid slice"/);
  assert.match(tileArt.composeTile({ name: 'TV', glyph: 'tv' }), /<g transform=/);
  assert.equal(tileArt.glyphForName('Remote Input'), 'pointer');
  assert.equal(tileArt.glyphForName('Desktop'), 'monitor');
  assert.equal(tileArt.glyphForName('TV'), 'tv');
  assert.equal(tileArt.glyphForName('Tekken 6'), null);
});

test('resolveGameTile: SteamGridDB poster composition is cached, emitted once and survives a failing lookup', async () => {
  const events = [];
  const requested = [];
  const requestBuffer = async (url) => {
    requested.push(url);
    if (url.includes('/search/autocomplete/')) return json([{ id: 7, name: 'Tekken 6' }]);
    if (url.includes('/grids/game/7')) return json([{ id: 1, url: 'https://cdn2.steamgriddb.com/grid/p.png', width: 600, height: 900 }]);
    if (url.endsWith('/grid/p.png')) return { body: solidPng(60, 90, [200, 30, 20]) };
    throw new Error(`unexpected ${url}`);
  };
  const resolver = createIconResolver({ userData: tmp(), secrets: { steamGridDbKey: 'K' }, requestBuffer, onArt: (event) => events.push(event) });
  const first = await resolver.resolveGameTile({ name: 'Tekken 6' });
  assert.equal(first.source, 'steamgriddb');
  const svg = fs.readFileSync(fileURLToPath(first.url), 'utf8');
  assert.match(svg, /data:image\/png;base64,/);
  assert.match(svg, /#c81e14/i);
  assert.deepEqual(events, [{ kind: 'game', name: 'Tekken 6', url: first.url }]);
  const calls = requested.length;
  assert.deepEqual(await resolver.resolveGameTile({ name: 'tekken 6' }), first);
  assert.equal(requested.length, calls, 'served from the 14 day cache');
  await resolver.prune();
  assert.ok(fs.existsSync(fileURLToPath(first.url)));
});

test('resolveGameTile: built-ins and unknown games get a monogram tile without network access', async () => {
  const requestBuffer = async () => { throw new Error('offline'); };
  const resolver = createIconResolver({ userData: tmp(), secrets: { steamGridDbKey: 'K' }, requestBuffer });
  const builtin = await resolver.resolveGameTile({ name: 'Desktop', builtin: true });
  assert.equal(builtin.source, 'monogram');
  assert.match(Buffer.from(builtin.url.split(',')[1], 'base64').toString(), /<g transform=/);
  const missing = await resolver.resolveGameTile({ name: 'Unknown Game' });
  assert.equal(missing.source, 'monogram');
  assert.match(missing.url, /^data:image\/svg\+xml;base64,/);
  const keyless = createIconResolver({ userData: tmp() });
  assert.equal((await keyless.resolveGameTile({ name: 'Doom' })).source, 'monogram');
});

test('preset tile art emits art-updated when a download finishes', async () => {
  const events = [];
  const fetchSite = async (url) => {
    if (url === 'https://www.netflix.com/') return { url, body: Buffer.from('<link rel="apple-touch-icon" href="/a.png">') };
    if (url.endsWith('/a.png')) return { url, body: solidPng(180, 180, [229, 9, 20]) };
    throw new Error('404');
  };
  const resolver = createIconResolver({ userData: tmp(), fetchSite, onArt: (event) => events.push(event) });
  const url = await resolver.resolvePresetIcon('netflix');
  await resolver.resolvePresetIcon('netflix');
  assert.deepEqual(events, [{ kind: 'preset', id: 'netflix', url }]);
});

test('parseApiApps keeps the Vibepollo payload hints (index, built-in placeholder images, cover presence)', () => {
  const tiles = parseApiApps({ apps: [
    { name: 'Desktop', id: '1', index: 0, 'image-path': 'assets/desktoppc.png' },
    { name: 'Remote Input', id: '2', index: 2, 'image-path': 'remote-session/remote-input.png', 'remote-session': 'input' },
    { name: 'Tekken 6', id: '3', index: 5, 'image-path': 'C:\\Program Files\\Apollo\\config/covers/igdb_1236.png' },
    { name: 'No Image', id: '4', index: 6 }
  ] }, { host: 'h', moonlightPath: 'm' });
  assert.deepEqual(tiles.map((tile) => tile.artHint), ['builtin', 'builtin', 'game', 'game']);
  assert.deepEqual(tiles.map((tile) => tile.hasHostCover), [true, true, true, false]);
  assert.equal(tiles[2].appIndex, 5);
  assert.equal(tiles[2].icon, '');
});

test('remote sync downloads the authenticated cover route and falls back cleanly on HTTP 403', async () => {
  const dir = tmp();
  const cachePath = path.join(dir, 'remote-apps.json');
  const payload = { apps: [{ name: 'Tekken 6', id: '3', index: 5, 'image-path': 'C:\\covers\\x.png' }] };
  const base = { enabled: true, host: '192.0.2.10', apiUrl: 'https://192.0.2.10:47990', allowSelfSigned: true, moonlightPath: process.execPath };
  const seen = [];
  const run = (requestBuffer) => listRemoteApps(base, cachePath, {
    token: 'T', platform: 'win32', requestJson: async () => payload, requestBuffer,
    run: async () => { throw new Error('moonlight unavailable'); }
  });
  const ok = await run(async (url, options) => {
    seen.push([url, options.headers.Authorization]);
    return { body: solidPng(4, 6, [1, 2, 3]), headers: {} };
  });
  assert.equal(seen[0][0], 'https://192.0.2.10:47990/api/apps/5/cover');
  assert.equal(seen[0][1], 'Bearer T');
  assert.match(ok.tiles[0].icon, /^file:/);
  assert.equal(ok.tiles[0].artHint, 'game');
  const denied = await listRemoteApps({ ...base, host: '192.0.2.11', apiUrl: 'https://192.0.2.11:47990' }, path.join(dir, 'other.json'), {
    token: 'T', platform: 'win32', requestJson: async () => payload,
    requestBuffer: async () => { throw new Error('Host returned HTTP 403'); },
    run: async () => { throw new Error('moonlight unavailable'); }
  });
  assert.equal(denied.status, 'online');
  assert.equal(denied.tiles[0].icon, '');
});

test('icons extension exposes gameTile and forwards art-updated events', async () => {
  assert.equal(typeof icons.handlers.gameTile, 'function');
  const emitted = [];
  const ctx = { userData: tmp(), secrets: {}, config: () => ({}), emit: (event, payload) => emitted.push([event, payload]) };
  const result = await icons.handlers.gameTile(ctx, { name: 'TV', builtin: true });
  assert.equal(result.source, 'monogram');
  icons.stop();
});

test('renderer: art-updated applies preset swaps and announces game art; gameTile results are cached', async () => {
  AssetUrl.applyArtUpdate({ kind: 'preset', id: 'netflix', url: 'file:///cache/presets/netflix.svg' });
  assert.equal(AssetUrl.assetUrl('preset:netflix'), 'file:///cache/presets/netflix.svg');
  AssetUrl.applyArtUpdate({ kind: 'game', name: 'Tekken 6', url: 'https://evil.test/x.svg' });
  assert.equal(AssetUrl.gameArtFor('Tekken 6'), '');
  AssetUrl.applyArtUpdate({ kind: 'game', name: 'Tekken 6', url: 'file:///cache/games/a.svg' });
  assert.equal(AssetUrl.gameArtFor('tekken 6'), 'file:///cache/games/a.svg');
  assert.equal(await AssetUrl.requestGameArt('Tekken 6'), 'file:///cache/games/a.svg');
  assert.equal(await AssetUrl.requestGameArt('Nothing'), '', 'no bridge outside the app');
});
