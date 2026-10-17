'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { launchSpec } = require('../launch-spec');
const { resolveBinary } = require('../binary-resolver');
const { LibraryService } = require('../library-service');
const { ProcessManager } = require('../../src/main/process-manager');

test('builds moonlight, native and webapp specifications', () => {
  assert.deepEqual(launchSpec({ type: 'moonlight', command: 'moonlight', host: '10.0.0.2', appName: 'Desktop', streamArgs: ['--1080'] }),
    { command: 'moonlight', args: ['stream', '10.0.0.2', 'Desktop', '--1080'] });
  assert.throws(() => launchSpec({ type: 'moonlight', command: 'moonlight', host: '-bad', appName: 'x' }), /host/);
  assert.deepEqual(launchSpec({ type: 'native', command: 'game', args: ['-f'] }), { command: 'game', args: ['-f'] });
  assert.deepEqual(launchSpec({ type: 'webapp', command: 'chromium', url: 'https://example.com/a?b=c' }).args,
    ['--kiosk', '--no-first-run', '--app=https://example.com/a?b=c']);
  assert.throws(() => launchSpec({ type: 'webapp', command: 'chromium', url: 'file:///etc/passwd' }), /HTTP/);
  assert.throws(() => launchSpec({ type: 'bogus', command: 'x' }), /Unsupported/);
});

test('resolves existing binaries and reports missing ones', async () => {
  assert.ok(await resolveBinary(process.execPath));
  assert.equal(await resolveBinary('definitely-not-installed-binary'), null);
});

test('launchChecked rejects missing executables without spawning', async () => {
  let spawned = false;
  const manager = new ProcessManager(() => { spawned = true; });
  await assert.rejects(manager.launchChecked({ id: 'x', command: 'definitely-not-installed-binary' }), /Executable not found/);
  assert.equal(spawned, false);
  assert.equal(manager.active, null);
});

test('launchChecked starts a real detached process and emits lifecycle events', async () => {
  const manager = new ProcessManager();
  const started = once(manager, 'started');
  const finished = once(manager, 'finished');
  const { pid } = await manager.launchChecked({ id: 'node', command: process.execPath, args: ['-e', 'process.exit(3)'] });
  assert.ok(pid > 0);
  assert.equal((await started)[0].tileId, 'node');
  assert.equal((await finished)[0].code, 3);
});

test('library flags offline cached payloads and forwards progress', async () => {
  const library = new LibraryService();
  const progress = [];
  library.on('sync-progress', (value) => progress.push(value.phase));
  const snapshot = await library.sync(async (report) => {
    report({ phase: 'offline', completed: 0, total: 0 });
    return { status: 'cached', host: 'pc', tiles: [{ id: 'a' }], error: 'timeout' };
  });
  assert.equal(snapshot.isVibepolloOffline, true);
  assert.deepEqual(progress, ['offline']);
  assert.equal(library.getGameLibrary().tiles.length, 1);
  assert.equal((await library.sync(async () => ({ status: 'online', tiles: [] }))).isVibepolloOffline, false);
});
