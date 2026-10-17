'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { scanFolder, isSupportedMedia } = require('../wallpaper-folder');
const { OnlineWallpapers } = require('../online-wallpapers');
const { CATALOG } = require('../online-wallpapers-catalog');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRusAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hml-wallpaper-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return directory;
}

test('isSupportedMedia accepts only image and video extensions', () => {
  for (const name of ['a.PNG', 'b.jpg', 'c.jpeg', 'd.webp', 'e.gif', 'f.avif', 'g.mp4', 'h.webm']) assert.equal(isSupportedMedia(name), true, name);
  for (const name of ['a.txt', 'b.exe', 'c', '.png.bak', 'd.svg']) assert.equal(isSupportedMedia(name), false, name);
});

test('scanFolder lists media recursively to depth 2 with stable ids and humanised names', async (t) => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, 'a', 'b', 'c'), { recursive: true });
  await fs.mkdir(path.join(root, '.hidden'));
  await fs.writeFile(path.join(root, 'misty_lake-view.png'), png);
  await fs.writeFile(path.join(root, 'clip.webm'), Buffer.alloc(16, 1));
  await fs.writeFile(path.join(root, 'notes.txt'), 'x');
  await fs.writeFile(path.join(root, '.secret.png'), png);
  await fs.writeFile(path.join(root, '.hidden', 'x.png'), png);
  await fs.writeFile(path.join(root, 'a', 'one.jpg'), jpeg);
  await fs.writeFile(path.join(root, 'a', 'b', 'two.jpg'), jpeg);
  await fs.writeFile(path.join(root, 'a', 'b', 'c', 'three.jpg'), jpeg);
  const first = await scanFolder(root);
  assert.deepEqual(first.map((item) => path.relative(root, item.file).split(path.sep).join('/')),
    ['a/b/two.jpg', 'a/one.jpg', 'clip.webm', 'misty_lake-view.png']);
  const lake = first.find((item) => item.kind === 'image' && item.name === 'Misty Lake View');
  assert.ok(lake);
  assert.equal(first.find((item) => item.kind === 'video').size, 16);
  assert.ok(path.isAbsolute(lake.file));
  const second = await scanFolder(root);
  assert.deepEqual(second.map((item) => item.id), first.map((item) => item.id));
  assert.equal(new Set(first.map((item) => item.id)).size, first.length);
});

test('scanFolder applies the limit, skips oversize files and rejects bad folders', async (t) => {
  const root = await temp(t);
  for (let index = 0; index < 5; index += 1) await fs.writeFile(path.join(root, `w${index}.png`), png);
  const big = path.join(root, 'huge.png');
  await fs.writeFile(big, '');
  await fs.truncate(big, 25 * 1024 * 1024);
  assert.equal((await scanFolder(root, { limit: 3 })).length, 3);
  assert.equal((await scanFolder(root)).some((item) => item.name === 'Huge'), false);
  await assert.rejects(scanFolder(path.join(root, 'missing')), /does not exist/);
  await assert.rejects(scanFolder('relative/dir'), /absolute/);
  await assert.rejects(scanFolder(path.join(root, 'w0.png')), /not a folder/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scanFolder(root, { signal: controller.signal }), /cancelled/);
});

test('scanFolder skips symlinks that escape the folder', async (t) => {
  const root = await temp(t);
  const outside = await temp(t);
  await fs.writeFile(path.join(outside, 'leak.png'), png);
  await fs.writeFile(path.join(root, 'inside.png'), png);
  try {
    await fs.symlink(path.join(outside, 'leak.png'), path.join(root, 'leak.png'));
    await fs.symlink(outside, path.join(root, 'dir'), 'junction');
  } catch { t.skip('symlinks unavailable'); return; }
  assert.deepEqual((await scanFolder(root)).map((item) => item.name), ['Inside']);
});

test('catalog has unique ids, https image URLs and complete metadata', () => {
  assert.ok(CATALOG.length >= 60, `catalog size ${CATALOG.length}`);
  assert.equal(new Set(CATALOG.map((entry) => entry.id)).size, CATALOG.length);
  for (const entry of CATALOG) {
    for (const key of ['id', 'name', 'url', 'thumbUrl', 'author', 'license', 'source', 'category']) assert.ok(entry[key], `${entry.id}.${key}`);
    assert.equal(new URL(entry.url).protocol, 'https:');
    assert.equal(new URL(entry.thumbUrl).protocol, 'https:');
  }
});

function fixture(t, handler) {
  return temp(t).then((directory) => {
    const calls = [];
    const requestBuffer = async (url, options) => { calls.push({ url, options }); return handler(url, options, calls.length); };
    return { directory, calls, service: new OnlineWallpapers(directory, null, { requestBuffer }) };
  });
}

test('ensureCached downloads once, validates magic bytes, dedupes concurrent calls', async (t) => {
  const { directory, calls, service } = await fixture(t, async () => ({ body: jpeg, headers: {} }));
  const id = CATALOG[0].id;
  const [a, b] = await Promise.all([service.ensureCached(id), service.ensureCached(id)]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CATALOG[0].url);
  assert.equal(calls[0].options.maxBytes, 12 * 1024 * 1024);
  assert.ok(path.isAbsolute(a) && a.startsWith(path.join(directory, 'online-wallpapers')) && a.endsWith('.jpg'));
  assert.deepEqual(await fs.readFile(a), jpeg);
  assert.equal(await service.ensureCached(id), a);
  assert.equal(calls.length, 1);
});

test('ensureCached rejects unknown ids, offline hosts and non-image bodies and emits warnings', async (t) => {
  const warnings = [];
  const { service, calls } = await fixture(t, async (url, options, count) => {
    if (count === 1) throw new Error('getaddrinfo ENOTFOUND');
    return { body: Buffer.from('<html>not an image</html>'), headers: {} };
  });
  service.on('warning', (warning) => warnings.push(warning.message));
  await assert.rejects(service.ensureCached('https://evil.example/a.png'), /Unknown/);
  await assert.rejects(service.ensureCached(CATALOG[0].id), /unavailable/);
  await assert.rejects(service.ensureCached(CATALOG[1].id), /invalid image/);
  assert.equal(calls.length, 2);
  assert.equal(warnings.length, 2);
});

test('prefetch limits concurrency to two and ignores failures', async (t) => {
  let active = 0;
  let peak = 0;
  const { service } = await fixture(t, async (url, options, count) => {
    active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    if (count === 2) throw new Error('boom');
    return { body: Buffer.concat([jpeg, Buffer.from(String(count))]), headers: {} };
  });
  service.on('warning', () => {});
  await service.prefetch(CATALOG.slice(0, 6).map((entry) => entry.id).concat('nope'));
  assert.equal(peak, 2);
  assert.equal((await service.listCache()).length, 5);
});

test('prune evicts least recently used files and clear removes the cache', async (t) => {
  const { service } = await fixture(t, async (url, options, count) => ({ body: Buffer.concat([jpeg, Buffer.alloc(100, count)]), headers: {} }));
  const ids = CATALOG.slice(0, 3).map((entry) => entry.id);
  const files = [];
  for (const id of ids) files.push(await service.ensureCached(id));
  const old = new Date(Date.now() - 100000);
  await fs.utimes(files[1], old, old);
  const size = (await fs.stat(files[0])).size;
  assert.equal(await service.prune(size * 2), 1);
  await assert.rejects(fs.stat(files[1]));
  assert.equal(await service.prune(0), 2);
  await service.ensureCached(ids[0]);
  assert.equal(await service.clear(), 1);
  assert.equal((await service.listCache()).length, 0);
});
