'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ACTIONS,
  decodeRemoteKeymapArgument,
  encodeRemoteKeymap,
  loadRemoteKeymap,
  validateRemoteKeymap,
} = require('../src/main/remote-keymap');

test('loads the shared remote keymap with the required mappings', () => {
  const map = loadRemoteKeymap();
  assert.deepEqual(Object.keys(map).sort(), ['axisDeadzone', 'buttons', 'exitButtons', 'keys', 'longKeys', 'longPressMs'].sort());
  assert.equal(map.axisDeadzone, 0.6);
  assert.equal(map.longPressMs, 700);
  assert.deepEqual(map.exitButtons, [16]);
  assert.equal(map.buttons['16'], 'close');
  assert.equal(map.keys.Home, 'home');
  assert.equal(map.keys.BrowserHome, 'home');
  assert.equal(map.longKeys.BrowserBack, 'close');
  assert.equal(map.longKeys.GoBack, 'close');
  assert.deepEqual([...ACTIONS].sort(), ['back', 'close', 'confirm', 'down', 'home', 'left', 'right', 'up']);
  assert.ok(Object.values(map.buttons).every((action) => ACTIONS.has(action)));
  assert.ok(Object.values(map.keys).every((action) => ACTIONS.has(action)));
});

test('encoded remote keymap round-trips through the preload argument format', () => {
  const map = loadRemoteKeymap();
  const argument = `--hml-keymap=${encodeRemoteKeymap(map)}`;
  assert.deepEqual(decodeRemoteKeymapArgument(argument), map);
});

test('missing or invalid keymap arguments return null for exit-only fallback', () => {
  assert.equal(decodeRemoteKeymapArgument(undefined), null);
  assert.equal(decodeRemoteKeymapArgument('--hml-keymap=not-base64!'), null);
  assert.equal(decodeRemoteKeymapArgument('--hml-keymap=eyJidXR0b25zIjp7fX0='), null);
});

test('rejects missing fields, unsupported actions, and out-of-range values', () => {
  const valid = loadRemoteKeymap();
  assert.throws(() => validateRemoteKeymap({ buttons: {} }), /missing/);
  assert.throws(() => validateRemoteKeymap({ ...valid, buttons: { 0: 'menu' } }), /action/);
  assert.throws(() => validateRemoteKeymap({ ...valid, buttons: { 32: 'up' } }), /index/);
  assert.throws(() => validateRemoteKeymap({ ...valid, longKeys: { BrowserBack: 'launch' } }), /action/);
  assert.throws(() => validateRemoteKeymap({ ...valid, buttons: { ...valid.buttons, 16: 'back' } }), /map to close/);
  assert.throws(() => validateRemoteKeymap({ ...valid, axisDeadzone: 1.1 }), /axisDeadzone/);
  assert.throws(() => validateRemoteKeymap({ ...valid, longPressMs: 0 }), /longPressMs/);
  assert.throws(() => validateRemoteKeymap({ ...valid, exitButtons: [32] }), /exitButtons/);
});
