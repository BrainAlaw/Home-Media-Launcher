'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/main/admin/panel/form-model');

test('fieldsFor returns group fields in descriptor order and marks objects read-only', () => {
  const descriptor = { SETTINGS: [
    { path: 'first', group: 'g', type: 'text' },
    { path: 'other', group: 'x', type: 'text' },
    { path: 'second', group: 'g', type: 'object' }
  ] };
  assert.deepEqual(model.fieldsFor(descriptor, 'g').map((entry) => [entry.path, entry.readOnly]), [
    ['first', false], ['second', true]
  ]);
});

test('valueAt reads dotted paths and returns undefined for missing paths', () => {
  assert.equal(model.valueAt({ nested: { value: 7 } }, 'nested.value'), 7);
  assert.equal(model.valueAt({}, 'nested.value'), undefined);
});

test('withValue immutably updates dotted paths without mutating input', () => {
  const before = { nested: { value: 1 }, sibling: true };
  const after = model.withValue(before, 'nested.value', 2);
  assert.deepEqual(before, { nested: { value: 1 }, sibling: true });
  assert.deepEqual(after, { nested: { value: 2 }, sibling: true });
  assert.notEqual(after, before);
  assert.notEqual(after.nested, before.nested);
});

test('validateField provides client hints for supported types and unknown enum values', () => {
  assert.equal(model.validateField({ type: 'boolean' }, true).valid, true);
  assert.equal(model.validateField({ type: 'text' }, 'abc').valid, true);
  assert.equal(model.validateField({ type: 'number', min: 1, max: 5 }, 6).valid, false);
  assert.equal(model.validateField({ type: 'enum', options: ['a', 'b'] }, 'a').valid, true);
  const unknown = model.validateField({ type: 'enum', options: ['a', 'b'] }, 'legacy');
  assert.equal(unknown.valid, false);
  assert.match(unknown.message, /available options/);
});

test('changedPaths lists only changed leaf paths and treats arrays as values', () => {
  assert.deepEqual(model.changedPaths({ a: 1, nested: { b: 2 }, list: [1] }, { a: 1, nested: { b: 3 }, list: [1, 2] }), [
    'nested.b', 'list'
  ]);
  assert.deepEqual(model.changedPaths({ a: 1 }, { a: 1 }), []);
});
