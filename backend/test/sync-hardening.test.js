'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { cacheArtwork, pruneArtwork } = require('../artwork');
const { LibraryService } = require('../library-service');
const { listRemoteApps } = require('../../src/main/remote-apps');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRusAAAAASUVORK5CYII=', 'base64');
const png2 = Buffer.concat([png, Buffer.from([0])]);

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-hard-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
const exists = (file) => fs.access(file).then(() => true, () => false);
const old = async (file) => { const past = new Date(Date.now() - 7200000); await fs.utimes(file, past, past); };

test('pruneArtwork removes only old unreferenced content-addressed files and stale temp files', async (t) => {
  const directory = await temporary(t);
  const keepUrl = await cacheArtwork(`data:image/png;base64,${png.toString('base64')}`, directory);
  const dropUrl = await cacheArtwork(`data:image/png;base64,${png2.toString('base64')}`, directory);
  const freshUrl = await cacheArtwork(`data:image/png;base64,${Buffer.concat([png, Buffer.from([1])]).toString('base64')}`, directory);
  const keep = new URL(keepUrl).pathname.replace(/^\//, '');
  const keepFile = require('node:url').fileURLToPath(keepUrl);
  const dropFile = require('node:url').fileURLToPath(dropUrl);
  const freshFile = require('node:url').fileURLToPath(freshUrl);
  const tmp = path.join(directory, `${'a'.repeat(64)}.png.${require('node:crypto').randomUUID()}.tmp`);
  const foreign = path.join(directory, 'notes.txt');
  await fs.writeFile(tmp, 'x'); await fs.writeFile(foreign, 'x');
  for (const file of [keepFile, dropFile, tmp, foreign]) await old(file);
  const removed = await pruneArtwork(directory, [keepUrl]);
  assert.ok(keep);
  assert.equal(removed, 2);
  assert.equal(await exists(keepFile), true);
  assert.equal(await exists(dropFile), false);
  assert.equal(await exists(tmp), false);
  assert.equal(await exists(freshFile), true);
  assert.equal(await exists(foreign), true);
});

test('successful sync prunes orphaned artwork but keeps icon overrides', async (t) => {
  const directory = await temporary(t);
  const cache = path.join(directory, 'remote.json');
  const artwork = path.join(directory, 'artwork');
  const orphan = require('node:url').fileURLToPath(await cacheArtwork(`data:image/png;base64,${png2.toString('base64')}`, artwork));
  const overrideUrl = await cacheArtwork(`data:image/png;base64,${Buffer.concat([png, Buffer.from([9])]).toString('base64')}`, artwork);
  const override = require('node:url').fileURLToPath(overrideUrl);
  await fs.writeFile(path.join(directory, 'icon-overrides.json'), JSON.stringify({ version: 1, icons: { a: overrideUrl } }));
  await old(orphan); await old(override);
  const remote = { enabled: true, host: 'pc', apiUrl: 'https://pc:47990' };
  const result = await listRemoteApps(remote, cache, {
    token: 't', requestJson: async () => ({ apps: [{ name: 'G', id: 1, cover: 'https://pc:47990/i' }] }),
    requestBuffer: async () => ({ body: png })
  });
  assert.equal(result.status, 'online');
  assert.equal(await exists(orphan), false);
  assert.equal(await exists(override), true);
  assert.equal(await exists(require('node:url').fileURLToPath(result.tiles[0].icon)), true);
});

test('artwork deadline keeps previous icon source so the next sync does not redownload', async (t) => {
  const directory = await temporary(t);
  const cache = path.join(directory, 'remote.json');
  const remote = { enabled: true, host: 'pc', apiUrl: 'https://pc:47990' };
  let downloads = 0;
  const options = { token: 't', requestJson: async () => ({ apps: [{ name: 'G', id: 1, cover: 'https://pc:47990/i' }] }), requestBuffer: async () => { downloads++; return { body: png }; } };
  await listRemoteApps(remote, cache, options);
  const realNow = Date.now;
  let calls = 0;
  // Expire the 10s artwork deadline on the first check inside cacheTile.
  Date.now = () => { calls++; return calls > 6 ? realNow() + 60000 : realNow(); };
  try { await listRemoteApps({ ...remote, streamArgs: ['x'] }, cache, options); } finally { Date.now = realNow; }
  const saved = JSON.parse(await fs.readFile(cache, 'utf8'));
  assert.equal(saved.tiles[0].iconSource, 'https://pc:47990/i');
});

test('LibraryService ignores stale results from an older overlapping sync', async () => {
  const library = new LibraryService();
  let release;
  const slow = library.sync(() => new Promise((resolve) => { release = () => resolve({ tiles: [{ id: 'old' }], status: 'online' }); }));
  await library.sync(async () => ({ tiles: [{ id: 'new' }], status: 'online' }));
  release();
  await slow;
  assert.equal(library.getGameLibrary().tiles[0].id, 'new');
});
