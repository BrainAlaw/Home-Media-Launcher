'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Sources = require('../../src/renderer/wallpaper-sources');
const { parseCatalogue, MAX_ENTRIES_PER_SOURCE } = require('../online-catalogue');
const { OnlineWallpapers } = require('../online-wallpapers');
const { CATALOG } = require('../online-wallpapers-catalog');
const { WallpaperPlaylist } = require('../wallpaper-playlist');
const { WallpaperSourceService } = require('../wallpaper-source-service');
const { validateConfig } = require('../../src/main/config');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const CATALOGUE_URL = 'https://walls.example.org/list.json';
const catalogueBody = Buffer.from(JSON.stringify({
  name: 'Example walls',
  wallpapers: [
    { id: 'one', title: 'Misty Alps', url: 'https://walls.example.org/a.jpg', author: 'Ann', license: 'CC BY 4.0', source: 'https://walls.example.org/a', location: 'Switzerland' },
    { title: 'Plain', url: 'https://walls.example.org/b.jpg' },
    { title: 'Insecure', url: 'http://walls.example.org/c.jpg' },
    { title: 'Credentials', url: 'https://user:pw@walls.example.org/d.jpg' },
    { title: 'LAN', url: 'https://192.168.1.5/e.jpg' },
    { title: 'Localhost', url: 'https://localhost/f.jpg' }
  ]
}));

async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hml-sources-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return directory;
}

test('parseOnlineLocation accepts https and known providers, rejects everything else', () => {
  assert.equal(Sources.parseOnlineLocation('https://walls.example.org/list.json#x').location, 'https://walls.example.org/list.json');
  assert.deepEqual(Sources.parseOnlineLocation('builtin:wikimedia-commons').builtin, 'wikimedia-commons');
  for (const bad of ['', '   ', 'http://example.com/a.json', 'ftp://example.com/a', 'file:///etc/passwd', 'https://user:pw@example.com/a.json',
    'https://localhost/a.json', 'https://127.0.0.1/a.json', 'https://10.0.0.4/a.json', 'https://192.168.0.2/a.json', 'https://172.20.1.1/a.json',
    'https://169.254.169.254/latest', 'https://[::1]/a.json', 'https://nas/a.json', 'https://printer.local/a.json', 'builtin:unknown', 'not a url', 42, null]) {
    assert.equal(Sources.parseOnlineLocation(bad).ok, false, String(bad));
  }
  assert.equal(Sources.parseOnlineLocation(`https://example.com/${'a'.repeat(3000)}`).ok, false);
});

test('normaliseSources cleans, de-duplicates and caps the list', () => {
  const abs = path.resolve('/walls');
  const list = Sources.normaliseSources([
    { id: 'f1', kind: 'folder', location: abs, label: ' Mine ', enabled: false },
    { kind: 'folder', location: abs },
    { kind: 'folder', location: 'relative/path' },
    { kind: 'online', location: 'http://insecure.example.com/x.json' },
    { kind: 'online', location: 'builtin:wikimedia-commons' },
    { id: '../evil', kind: 'online', location: CATALOGUE_URL },
    null, 'x', { kind: 'other', location: abs }
  ]);
  assert.deepEqual(list.map((source) => [source.kind, source.enabled, source.label]), [
    ['folder', false, 'Mine'], ['online', true, 'Wikimedia Commons (curated)'], ['online', true, 'walls.example.org']
  ]);
  assert.equal(list[0].id, 'f1');
  assert.match(list[2].id, /^online-/);
  const many = Array.from({ length: 80 }, (_unused, index) => ({ kind: 'folder', location: path.resolve(`/w${index}`) }));
  assert.equal(Sources.normaliseSources(many).length, Sources.MAX_SOURCES);
});

test('deriveSources migrates legacy folders and the online flag, and keeps saved sources authoritative', () => {
  const abs = path.resolve('/walls');
  const migrated = Sources.deriveSources({ folders: [{ path: abs, name: 'Walls' }], online: true }, undefined);
  assert.equal(migrated.migrated, true);
  assert.deepEqual(migrated.sources.map((source) => [source.kind, source.location === abs || source.location.startsWith('builtin:'), source.enabled]), [['folder', true, true], ['online', true, true]]);
  const off = Sources.deriveSources({ folders: [], online: false }, undefined);
  assert.equal(off.sources[0].enabled, false);
  const saved = Sources.deriveSources({ folders: [{ path: abs }], online: true }, []);
  assert.deepEqual(saved, { sources: [], migrated: false });
});

test('projectToWallpaper exposes enabled folders and the online flag', () => {
  const a = path.resolve('/a');
  const b = path.resolve('/b');
  const sources = Sources.normaliseSources([
    { kind: 'folder', location: a, enabled: true }, { kind: 'folder', location: b, enabled: false },
    { kind: 'online', location: 'builtin:wikimedia-commons', enabled: false }
  ]);
  assert.deepEqual(Sources.projectToWallpaper({ folderPath: b }, sources), { folders: [{ path: a, name: 'a' }], online: false, folderPath: a });
  const enabledOnline = sources.map((source) => ({ ...source, enabled: true }));
  assert.equal(Sources.projectToWallpaper({ folderPath: b }, enabledOnline).folderPath, b);
  assert.equal(Sources.projectToWallpaper({}, enabledOnline).online, true);
});

test('createSource and formatBytes', () => {
  assert.equal(Sources.createSource('online', 'http://x.example.com/a.json').error, 'Only https:// addresses are allowed');
  assert.equal(Sources.createSource('folder', 'nope').error, 'Folder path must be absolute');
  assert.equal(Sources.createSource('online', CATALOGUE_URL, 'Mine').source.label, 'Mine');
  assert.deepEqual([0, 10, 5 * 1024 * 1024, 300 * 1024 * 1024, 3 * 1024 ** 3].map(Sources.formatBytes), ['0 MB', '<1 MB', '5.0 MB', '300 MB', '3.0 GB']);
});

test('parseCatalogue keeps only https image entries on public hosts and carries credit fields', () => {
  const parsed = parseCatalogue(catalogueBody, 'src-test');
  assert.equal(parsed.name, 'Example walls');
  assert.deepEqual(parsed.entries.map((entry) => entry.name), ['Misty Alps', 'Plain']);
  assert.equal(parsed.entries[0].id, 'src-test:one');
  assert.deepEqual([parsed.entries[0].author, parsed.entries[0].license, parsed.entries[0].location], ['Ann', 'CC BY 4.0', 'Switzerland']);
  assert.equal(parsed.entries[1].id, 'src-test:plain');
  assert.throws(() => parseCatalogue('not json', 's'), /not valid JSON/);
  assert.throws(() => parseCatalogue('{"a":1}', 's'), /list of wallpapers/);
  assert.throws(() => parseCatalogue('[{"url":"http://x.example.com/a.jpg"}]', 's'), /no usable/);
  assert.throws(() => parseCatalogue(Buffer.alloc(1024 * 1024 + 1, 32), 's'), /larger than 1 MB/);
  const big = JSON.stringify(Array.from({ length: MAX_ENTRIES_PER_SOURCE + 50 }, (_unused, index) => ({ title: `n${index}`, url: `https://walls.example.org/${index}.jpg` })));
  assert.equal(parseCatalogue(big, 's').entries.length, MAX_ENTRIES_PER_SOURCE);
});

function onlineFixture(t, handler) {
  return temp(t).then((directory) => {
    const calls = [];
    const requestBuffer = async (url, options) => { calls.push(url); return handler(url, options); };
    return { directory, calls, online: new OnlineWallpapers(directory, null, { requestBuffer }) };
  });
}

test('custom online sources load, credit their entries, honour enable flags and are image-only', async (t) => {
  const { online, calls } = await onlineFixture(t, async (url) => (url === CATALOGUE_URL ? { body: catalogueBody } : { body: jpeg }));
  assert.equal(online.catalog().length, CATALOG.length);
  online.setSources([{ kind: 'online', location: CATALOGUE_URL, enabled: true }]);
  await online.ready();
  const entries = online.catalog();
  assert.deepEqual(entries.map((entry) => entry.name), ['Misty Alps', 'Plain']);
  assert.deepEqual(online.credit(entries[0].id), { title: 'Misty Alps', author: 'Ann', license: 'CC BY 4.0', source: 'https://walls.example.org/a', location: 'Switzerland', origin: 'online' });
  const file = await online.ensureCached(entries[0].id);
  assert.ok(file.endsWith('.jpg'));
  assert.equal(online.credit(CATALOG[0].id), null);
  await assert.rejects(online.ensureCached(CATALOG[0].id), /Unknown/);
  const stats = await online.stats(CATALOGUE_URL);
  assert.equal(stats.count, 2);
  assert.ok(stats.cacheBytes > 0 && stats.available);
  online.setSources([{ kind: 'online', location: CATALOGUE_URL, enabled: false }, { kind: 'online', location: 'builtin:wikimedia-commons', enabled: true }]);
  assert.equal(online.catalog().length, CATALOG.length);
  assert.equal(calls.filter((url) => url === CATALOGUE_URL).length, 1);
});

test('catalogue failures fall back to the saved copy and report a problem otherwise', async (t) => {
  let offline = false;
  const { online } = await onlineFixture(t, async (url) => { if (offline) throw new Error('getaddrinfo ENOTFOUND'); return { body: url === CATALOGUE_URL ? catalogueBody : jpeg }; });
  online.on('warning', () => {});
  assert.equal((await online.probe(CATALOGUE_URL)).count, 2);
  offline = true;
  const fallback = await online.probe(CATALOGUE_URL);
  assert.equal(fallback.ok, false);
  assert.equal(fallback.count, 2);
  assert.match(fallback.error, /saved copy/);
  const missing = await online.probe('https://other.example.org/none.json');
  assert.deepEqual([missing.ok, missing.count], [false, 0]);
  assert.match(missing.error, /ENOTFOUND/);
  assert.equal((await online.probe('http://other.example.org/none.json')).ok, false);
  assert.equal((await online.probe('builtin:wikimedia-commons')).count, CATALOG.length);
});

test('playlist skips disabled folders and returns credits for online slides', async (t) => {
  const directory = await temp(t);
  const enabled = path.join(directory, 'on');
  const disabled = path.join(directory, 'off');
  await fs.mkdir(enabled); await fs.mkdir(disabled);
  await fs.writeFile(path.join(enabled, 'a.jpg'), jpeg);
  await fs.writeFile(path.join(disabled, 'b.jpg'), jpeg);
  const mediaAssets = { register: async (file) => `vibepollo-media://asset/${path.basename(file)}` };
  const online = { catalog: () => [{ id: 'x' }], ready: async () => {}, ensureCached: async () => path.join(enabled, 'a.jpg'), credit: () => ({ title: 'T' }) };
  const playlist = new WallpaperPlaylist({ mediaAssets, online });
  playlist.configureSources([{ kind: 'folder', location: enabled, enabled: true }, { kind: 'folder', location: disabled, enabled: false }]);
  const request = { folders: [enabled, disabled], online: true };
  assert.deepEqual(await playlist.count(request), { count: 2 });
  assert.equal((await playlist.slide(request, 0)).credit, null);
  assert.deepEqual((await playlist.slide(request, 1)).credit, { title: 'T' });
  assert.equal((await playlist.inspect(disabled)).total, 1);
});

test('source service applies sources, inspects them and probes catalogues without trusting the renderer', async (t) => {
  const { directory, online } = await onlineFixture(t, async (url) => ({ body: url === CATALOGUE_URL ? catalogueBody : jpeg }));
  const folder = path.join(directory, 'mine');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'a.jpg'), jpeg);
  await fs.writeFile(path.join(folder, 'clip.mp4'), jpeg);
  const playlist = new WallpaperPlaylist({ mediaAssets: { register: async () => 'x' }, online });
  const service = new WallpaperSourceService({ playlist, online });
  const sources = [
    { id: 'f', label: 'Mine', kind: 'folder', location: folder, enabled: true },
    { id: 'o', label: 'Example', kind: 'online', location: CATALOGUE_URL, enabled: true }
  ];
  service.apply({ wallpaperSources: sources, wallpaper: { online: true } });
  await online.ready();
  assert.equal(online.catalog().length, 2);
  const report = await service.handle('inspect', { sources: [...sources, { kind: 'online', location: 'http://bad.example.com/x.json' }, { kind: 'folder', location: 'relative' }] });
  assert.equal(report.sources.length, 2);
  assert.deepEqual([report.sources[0].images, report.sources[0].videos, report.sources[0].available], [1, 1, true]);
  assert.deepEqual([report.sources[1].count, report.sources[1].host], [2, 'walls.example.org']);
  assert.equal(report.onlineAvailable, true);
  assert.deepEqual(await service.handle('probe', { location: 'http://x.example.com/a.json' }), { ok: false, error: 'Only https:// addresses are allowed', count: 0, name: '', location: '' });
  assert.equal((await service.handle('probe', { location: CATALOGUE_URL })).name, 'Example walls');
  assert.equal((await service.handle('clearCache')).removed, 0);
  await assert.rejects(service.handle('format', {}), /Unknown wallpaper source action/);
  // Legacy configuration: no wallpaperSources, built-in catalogue gated by wallpaper.online.
  service.apply({ wallpaper: { folders: [{ path: folder, name: 'Mine' }], online: false } });
  assert.equal(online.catalog().length, CATALOG.length);
  assert.equal((await playlist.count({ folders: [folder], online: false })).count, 2);
});

test('configuration validation covers wallpaperSources and wallpaperCredit', () => {
  const rows = [];
  const folder = path.resolve('/walls');
  const good = [{ id: 'a', label: 'A', kind: 'folder', location: folder, enabled: true }, { id: 'b', kind: 'online', location: CATALOGUE_URL, enabled: false }];
  assert.doesNotThrow(() => validateConfig({ rows, settings: { wallpaperSources: good, wallpaperCredit: false } }));
  assert.throws(() => validateConfig({ rows, settings: { wallpaperSources: 'x' } }), /wallpaperSources/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaperSources: [{ ...good[0], location: 'relative' }] } }), /absolute/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaperSources: [{ ...good[1], location: 'http://x.example.com/a.json' }] } }), /https/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaperSources: [{ ...good[1], location: 'https://u:p@x.example.com/a.json' }] } }), /user name/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaperSources: [{ ...good[0], enabled: 'yes' }] } }), /boolean/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaperSources: [{ ...good[0], kind: 'usb' }] } }), /kind/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaperSources: [{ ...good[0], id: '../x' }] } }), /id/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaperCredit: 'no' } }), /wallpaperCredit/);
});
