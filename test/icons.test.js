'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const presets = require('../backend/web-presets');
const { validateConfig } = require('../src/main/config');
const { isPrivateAddress, assertAllowedUrl } = require('../backend/site-fetch');
const resolverModule = require('../backend/icon-resolver');
const { createIconResolver } = resolverModule;
const iconsExt = require('../src/main/ext/icons');

const PNG = (size) => {
  const buffer = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12);
  buffer.writeUInt32BE(size, 16);
  buffer.writeUInt32BE(size, 20);
  return buffer;
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));

test('presets: 16 entries with bundled icons and valid websites', () => {
  const list = presets.listPresets();
  assert.equal(list.length, 16);
  for (const preset of list) {
    assert.ok(['video', 'music', 'other'].includes(preset.category));
    assert.match(preset.color, /^#[0-9A-F]{6}$/i);
    assert.ok(fs.existsSync(fileURLToPath(preset.icon)), preset.id);
  }
  const websites = presets.firstRunWebsites();
  validateConfig({ rows: [], websites });
  assert.equal(presets.addPresetWebsites(websites, ['netflix', 'tidal', 'nope']).length, websites.length + 1);
  assert.equal(presets.matchPresetByHostname('music.youtube.com').id, 'youtube-music');
  assert.equal(presets.matchPresetByHostname('www.youtube.com').id, 'youtube');
  assert.equal(presets.matchPresetByHostname('example.com'), null);
});

test('ssrf guard rejects private targets', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  assert.throws(() => assertAllowedUrl('http://example.com/'));
  assert.throws(() => assertAllowedUrl('https://192.168.1.4/'));
  assert.throws(() => assertAllowedUrl('https://localhost/'));
  assert.doesNotThrow(() => assertAllowedUrl('https://192.168.1.4/', ['192.168.1.4']));
});

test('html and manifest parsing picks the largest icon', () => {
  const html = '<link rel="icon" href="/f.ico"><link rel="apple-touch-icon" sizes="180x180" href="/a.png"><link rel="icon" type="image/png" sizes="32x32" href="/s.png"><link rel="manifest" href="/m.json"><link rel="icon" href="http://evil/x.png">';
  const { candidates, manifest } = resolverModule.parseHtmlIcons(html, 'https://site.test/');
  assert.equal(manifest, 'https://site.test/m.json');
  assert.equal(candidates.length, 3);
  const all = candidates.concat(resolverModule.parseManifestIcons({ icons: [{ src: '/big.png', sizes: '512x512' }, { src: '/mask.png', sizes: '1024x1024', purpose: 'maskable' }] }, 'https://site.test/m.json'));
  assert.equal(resolverModule.rankCandidates(all)[0].url, 'https://site.test/big.png');
});

test('svg sanitiser rejects scripts and external references', () => {
  assert.ok(resolverModule.sanitizeSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')));
  assert.equal(resolverModule.sanitizeSvg(Buffer.from('<svg><script>1</script></svg>')), null);
  assert.equal(resolverModule.sanitizeSvg(Buffer.from('<svg><image href="https://x/y.png"/></svg>')), null);
  assert.equal(resolverModule.sanitizeSvg(Buffer.from('<svg onload="x()"></svg>')), null);
  assert.equal(resolverModule.sanitizeSvg(Buffer.from('not svg')), null);
});

test('resolve: preset wins without any network access', async () => {
  const resolver = createIconResolver({ userData: tmp(), fetchSite: async () => { throw new Error('network'); } });
  const result = await resolver.resolve({ kind: 'website', name: 'Netflix', url: 'https://www.netflix.com/browse' });
  assert.equal(result.source, 'preset');
});

test('resolve: site icon from apple-touch-icon is downloaded, cached and reused', async () => {
  const requested = [];
  const fetchSite = async (url) => {
    requested.push(url);
    if (url === 'https://my.test/') return { url, body: Buffer.from('<link rel="apple-touch-icon" sizes="180x180" href="/icon.png">') };
    if (url === 'https://my.test/icon.png') return { url, body: PNG(180) };
    throw new Error('404');
  };
  const userData = tmp();
  const resolver = createIconResolver({ userData, fetchSite });
  const first = await resolver.resolve({ kind: 'website', name: 'My', url: 'https://my.test/page' });
  assert.equal(first.source, 'site');
  assert.equal(first.width, 180);
  assert.ok(fs.existsSync(fileURLToPath(first.url)));
  const count = requested.length;
  const second = await resolver.resolve({ kind: 'website', name: 'My', url: 'https://my.test/page' });
  assert.deepEqual(second, first);
  assert.equal(requested.length, count);
  await resolver.prune();
});

test('resolve: falls back to letter tile when the site has nothing', async () => {
  const resolver = createIconResolver({ userData: tmp(), fetchSite: async () => { throw new Error('down'); } });
  const result = await resolver.resolve({ kind: 'website', name: 'Zed', url: 'https://nothing.test/' });
  assert.equal(result.source, 'letter');
  assert.match(result.url, /^data:image\/svg\+xml;base64,/);
});

test('resolve: games use SteamGridDB with the bearer key, then playnite cache, then letter', async () => {
  const calls = [];
  const requestBuffer = async (url, options) => {
    calls.push({ url, auth: options.headers?.Authorization });
    if (url.includes('/search/autocomplete/')) return { body: Buffer.from(JSON.stringify({ success: true, data: [{ id: 7, name: 'Halo' }] })) };
    if (url.includes('/grids/game/7')) return { body: Buffer.from(JSON.stringify({ success: true, data: [{ id: 1, url: 'https://cdn2.steamgriddb.com/grid/a.png', thumb: 'https://cdn2.steamgriddb.com/thumb/a.png', width: 600, height: 900 }] })) };
    if (url.startsWith('https://cdn2.steamgriddb.com/')) return { body: PNG(600) };
    throw new Error('unexpected');
  };
  const userData = tmp();
  const resolver = createIconResolver({ userData, secrets: { steamGridDbKey: 'SECRET' }, requestBuffer });
  const result = await resolver.resolve({ kind: 'game', name: 'Halo' });
  assert.equal(result.source, 'steamgriddb');
  assert.equal(calls[0].auth, 'Bearer SECRET');
  assert.ok(calls.some((call) => call.url.includes('dimensions=600x900')));
  assert.ok(fs.existsSync(fileURLToPath(result.url)));
  const candidates = await resolver.searchArtwork('Halo');
  assert.equal(candidates[0].gameName, 'Halo');
  await assert.rejects(resolver.cacheCandidate('https://evil.test/a.png'));

  const art = path.join(userData, 'art.png');
  fs.writeFileSync(art, PNG(64));
  fs.writeFileSync(path.join(userData, 'remote-apps.json'), JSON.stringify({ tiles: [{ name: 'Portal', icon: `file:///${art.replace(/\\/g, '/')}` }] }));
  const noKey = createIconResolver({ userData, secrets: {} });
  assert.equal((await noKey.resolve({ kind: 'game', name: 'Portal' })).source, 'playnite');
  assert.equal((await noKey.resolve({ kind: 'game', name: 'Unknown Game' })).source, 'letter');
});

test('resolve validates requests', async () => {
  const resolver = createIconResolver({ userData: tmp() });
  await assert.rejects(resolver.resolve({ kind: 'nope', name: 'x' }));
  await assert.rejects(resolver.resolve({ kind: 'website', name: 'x', url: 'file:///etc/passwd' }));
});

test('ext module exposes the documented handlers', () => {
  assert.equal(iconsExt.namespace, 'icons');
  for (const method of ['resolve', 'listPresets', 'searchArtwork', 'cacheCandidate', 'addPresetWebsites', 'firstRunWebsites', 'sizes']) assert.equal(typeof iconsExt.handlers[method], 'function');
  assert.equal(iconsExt.handlers.listPresets().length, 16);
});
