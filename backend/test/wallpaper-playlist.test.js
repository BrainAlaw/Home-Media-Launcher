'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { WallpaperPlaylist, scanMediaFolder } = require('../wallpaper-playlist');
const { validateConfig } = require('../../src/main/config');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRusAAAAASUVORK5CYII=', 'base64');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-wall-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await fs.mkdir(path.join(directory, 'sub', 'deep', 'deeper'), { recursive: true });
  for (const name of ['b10.png', 'b2.png', 'clip.mp4', 'notes.txt', path.join('sub', 'c.jpg'), path.join('sub', 'deep', 'deeper', 'too-deep.png')]) {
    await fs.writeFile(path.join(directory, name), png);
  }
  const registered = [];
  const mediaAssets = { register: async (file) => { registered.push(file); return `vibepollo-media://asset/${registered.length}`; } };
  return { directory, registered, mediaAssets };
}

test('folder scan finds media naturally sorted and honours the depth limit', async (t) => {
  const { directory } = await fixture(t);
  const files = await scanMediaFolder(directory);
  assert.deepEqual(files.map((file) => path.relative(directory, file.path).replace(/\\/g, '/')), ['b2.png', 'b10.png', 'clip.mp4', 'sub/c.jpg']);
});

test('inspect counts media and rejects folders that were never allowed', async (t) => {
  const { directory, mediaAssets } = await fixture(t);
  const playlist = new WallpaperPlaylist({ mediaAssets });
  await assert.rejects(playlist.inspect(directory), /Unknown wallpaper folder/);
  playlist.allowOne(directory);
  const info = await playlist.inspect(directory);
  assert.deepEqual([info.images, info.videos, info.total, info.available], [3, 1, 4, true]);
  await assert.rejects(playlist.inspect('relative/path'), /absolute/);
  const missing = path.join(directory, 'gone');
  playlist.allowOne(missing);
  assert.equal((await playlist.inspect(missing)).available, false);
});

test('slides register one file lazily and skip files that vanished', async (t) => {
  const { directory } = await fixture(t);
  const registered = [];
  const failing = new Set();
  const mediaAssets = { register: async (file) => { if (failing.has(file)) throw new Error('gone'); registered.push(file); return `vibepollo-media://asset/${registered.length}`; } };
  const playlist = new WallpaperPlaylist({ mediaAssets });
  playlist.allow([directory]);
  const request = { folders: [directory], online: false };
  assert.deepEqual(await playlist.count(request), { count: 4 });
  const first = await playlist.slide(request, 0);
  assert.equal(first.name, 'b2.png');
  assert.equal(registered.length, 1);
  failing.add(path.join(directory, 'clip.mp4'));
  assert.equal(await playlist.slide(request, 2), null);
  assert.equal(await playlist.slide(request, 99), null);
  await assert.rejects(playlist.slide(request, -1), /Invalid wallpaper index/);
  await assert.rejects(playlist.slide({ folders: [path.resolve('/not/allowed')], online: false }, 0), /Unknown wallpaper folder/);
  await assert.rejects(playlist.slide({ folders: 'x' }, 0), /Invalid wallpaper folder list/);
});

test('online items are appended only when opted in and cached through ensureCached', async (t) => {
  const { directory, mediaAssets, registered } = await fixture(t);
  const cachedFile = path.join(directory, 'b2.png');
  const online = { catalog: () => [{ id: 'one' }, { id: 'two' }], ensureCached: async (id) => { if (id === 'two') throw new Error('offline'); return cachedFile; } };
  const playlist = new WallpaperPlaylist({ mediaAssets, online });
  assert.deepEqual(await playlist.count({ folders: [], online: false }), { count: 0 });
  assert.deepEqual(await playlist.count({ folders: [], online: true }), { count: 2 });
  assert.equal((await playlist.slide({ folders: [], online: true }, 0)).kind, 'image');
  assert.equal(await playlist.slide({ folders: [], online: true }, 1), null);
  assert.equal(registered.length, 1);
});

test('configuration validation covers wallpaper and font settings', () => {
  const rows = [];
  const abs = path.resolve('/walls');
  assert.doesNotThrow(() => validateConfig({ rows, settings: { fontId: 'inter', wallpaper: { source: 'mixed', shuffle: true, online: false, folders: [{ path: abs, name: 'x' }] } } }));
  assert.throws(() => validateConfig({ rows, settings: { wallpaper: { source: 'weird' } } }), /wallpaper.source/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaper: { online: 'yes' } } }), /boolean/);
  assert.throws(() => validateConfig({ rows, settings: { wallpaper: { folders: [{ path: 'relative' }] } } }), /absolute/);
  assert.throws(() => validateConfig({ rows, settings: { fontId: '../evil' } }), /fontId/);
});
