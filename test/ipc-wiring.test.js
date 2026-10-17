'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const index = read('src/main/index.js');
const preload = read('src/main/preload.js');

const matches = (source, pattern) => [...source.matchAll(pattern)].map((m) => m[1]);

test('every invoked launcher channel has a main-process handler', () => {
  const handled = new Set(matches(index, /\bhandle\('(launcher:[\w-]+)'/g));
  const invoked = new Set(matches(preload, /invoke\('(launcher:[\w-]+)'/g));
  assert.ok(invoked.size > 20);
  for (const channel of invoked) assert.ok(handled.has(channel), `missing handler: ${channel}`);
  for (const channel of handled) assert.ok(invoked.has(channel), `handler without preload entry: ${channel}`);
});

test('every event channel subscribed in preload is emitted by main', () => {
  const listened = new Set(matches(preload, /(?:subscribe|ipcRenderer\.on)\('(launcher:[\w-]+)'/g));
  const emitted = new Set([
    ...matches(index, /send\('(launcher:[\w-]+)'/g),
    ...matches(index, /sendToWindow\('(launcher:[\w-]+)'/g),
    ...matches(index, /`(launcher:controller-)\$\{name\}`/g)
  ]);
  const controllerEvents = /launcher:controller-/;
  for (const channel of listened) {
    assert.ok(emitted.has(channel) || controllerEvents.test(channel), `no emitter for: ${channel}`);
  }
});

test('ipcMain.on listeners validate the sender', () => {
  for (const block of index.split('ipcMain.on(').slice(1)) {
    const head = block.slice(0, 400);
    assert.match(head, /event\.sender/);
    assert.match(head, /senderFrame/);
  }
});
