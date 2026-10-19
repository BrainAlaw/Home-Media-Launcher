'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BackgroundApps, backgroundLimit, validateBackgroundApps, DEFAULT_MAX } = require('../src/main/background-apps');

test('keeps apps in background order and evicts the oldest past the limit', () => {
  const apps = new BackgroundApps({ max: 3 });
  assert.deepEqual(apps.put('a'), []);
  assert.deepEqual(apps.put('b'), []);
  assert.deepEqual(apps.put('c'), []);
  assert.deepEqual(apps.put('d'), ['a'], 'the fourth app evicts the oldest');
  assert.deepEqual(apps.list(), ['b', 'c', 'd']);
});

test('re-adding an app moves it to the newest end without evicting', () => {
  const apps = new BackgroundApps({ max: 2 });
  apps.put('a');
  apps.put('b');
  assert.deepEqual(apps.put('a'), []);
  assert.deepEqual(apps.list(), ['b', 'a']);
  assert.deepEqual(apps.put('c'), ['b']);
});

test('resuming an app removes it from the background', () => {
  const apps = new BackgroundApps({ max: 3 });
  apps.put('a');
  apps.put('b');
  assert.equal(apps.take('a'), true);
  assert.equal(apps.has('a'), false);
  assert.equal(apps.take('a'), false, 'taking an unknown id is a no-op');
  assert.deepEqual(apps.list(), ['b']);
});

test('lowering the limit evicts the oldest apps at once', () => {
  const apps = new BackgroundApps({ max: 4 });
  ['a', 'b', 'c', 'd'].forEach((id) => apps.put(id));
  assert.deepEqual(apps.setMax(2), ['a', 'b']);
  assert.deepEqual(apps.list(), ['c', 'd']);
});

test('clear returns everything and empties the registry', () => {
  const apps = new BackgroundApps();
  apps.put('a');
  apps.put('b');
  assert.deepEqual(apps.clear(), ['a', 'b']);
  assert.deepEqual(apps.list(), []);
});

test('rejects invalid ids and limits', () => {
  const apps = new BackgroundApps();
  assert.throws(() => apps.put(''), TypeError);
  assert.throws(() => apps.put(42), TypeError);
  assert.throws(() => new BackgroundApps({ max: 0 }), RangeError);
  assert.throws(() => new BackgroundApps({ max: 9 }), RangeError);
  assert.throws(() => apps.setMax(1.5), RangeError);
});

test('settings default to three and accept only integers from 1 to 8', () => {
  assert.equal(DEFAULT_MAX, 3);
  assert.equal(backgroundLimit({}), 3);
  assert.equal(backgroundLimit({ backgroundApps: { max: 5 } }), 5);
  assert.equal(backgroundLimit({ backgroundApps: { max: 99 } }), 3, 'out of range falls back to the default');
  assert.doesNotThrow(() => validateBackgroundApps(undefined));
  assert.doesNotThrow(() => validateBackgroundApps({ max: 8 }));
  assert.throws(() => validateBackgroundApps({ max: 0 }), /backgroundApps\.max/);
  assert.throws(() => validateBackgroundApps({ max: '3' }), /backgroundApps\.max/);
  assert.throws(() => validateBackgroundApps([]), /must be an object/);
});
