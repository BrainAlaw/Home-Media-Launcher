'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/renderer/categories');
const { validateConfig } = require('../src/main/config');

test('defaults are theatre + gaming and are copies', () => {
  const a = C.defaults();
  assert.deepEqual(a.map((c) => c.id), ['theatre', 'gaming']);
  a[0].label = 'x';
  assert.equal(C.defaults()[0].label, 'Home Theatre');
});

test('slugify strips accents and symbols and never returns empty', () => {
  assert.equal(C.slugify('Zażółć Gęślą!'), 'zazolc-gesla');
  assert.equal(C.slugify('  ***  '), 'category');
});

test('add generates unique ids and rejects duplicates, empties', () => {
  let list = C.defaults();
  let r = C.add(list, 'Music');
  assert.ok(r.ok);
  list = r.list;
  assert.equal(list.at(-1).id, 'music');
  assert.equal(C.add(list, 'music').ok, false);
  assert.equal(C.add(list, '   ').ok, false);
  list = C.rename(list, 'music', 'Tunes');
  const r2 = C.add(list, 'Music!');
  assert.equal(r2.list.at(-1).id, 'music-2');
});

test('rename keeps id, built-ins removable never, custom removable', () => {
  let list = C.rename(C.defaults(), 'gaming', 'Games');
  assert.deepEqual(list[1], { id: 'gaming', label: 'Games', builtin: 'gaming' });
  assert.equal(C.rename(list, 'gaming', '  ')[1].label, 'Games');
  assert.equal(C.remove(list, 'gaming').length, 2);
  list = C.add(list, 'Kids').list;
  assert.equal(C.remove(list, 'kids').length, 2);
});

test('move swaps neighbours and clamps at edges', () => {
  const list = C.add(C.defaults(), 'Kids').list;
  assert.deepEqual(C.move(list, 'kids', -1).map((c) => c.id), ['theatre', 'kids', 'gaming']);
  assert.equal(C.move(list, 'theatre', -1), list);
  assert.equal(C.move(list, 'kids', 1), list);
});

test('normalise repairs bad data and restores built-ins', () => {
  const fixed = C.normalise([{ id: 'x', label: ' A ' }, { id: 'x', label: 'dup' }, { id: 'Bad Id', label: 'q' }, null, { id: 'y', label: '' }]);
  assert.deepEqual(fixed.map((c) => c.id), ['x', 'theatre', 'gaming']);
  assert.deepEqual(C.normalise(undefined), C.defaults());
});

test('config validation of categories and toggles', () => {
  const base = { rows: [] };
  assert.doesNotThrow(() => validateConfig({ ...base, settings: { categories: C.defaults(), showTileLabels: false, mediaWidget: true } }));
  assert.throws(() => validateConfig({ ...base, settings: { categories: [{ id: 'theatre', label: 'T', builtin: 'theatre' }] } }), /gaming/);
  assert.throws(() => validateConfig({ ...base, settings: { categories: [...C.defaults(), { id: 'gaming', label: 'x' }] } }), /duplicated/);
  assert.throws(() => validateConfig({ ...base, settings: { categories: [...C.defaults(), { id: 'A B', label: 'x' }] } }), /slug/);
  assert.throws(() => validateConfig({ ...base, settings: { showTileLabels: 'no' } }), /showTileLabels/);
});
