'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, findAction } = require('../backend/actions');

test('ACTIONS lists the five admin actions with unique names', () => {
  const names = ACTIONS.map((action) => action.name);
  assert.deepEqual(names, ['reload-config', 'restart-soloist', 'clear-cache', 'pair-tv', 'restart-launcher']);
  assert.equal(new Set(names).size, names.length);
});

test('every action has a label, group and help text', () => {
  for (const action of ACTIONS) {
    assert.equal(typeof action.label, 'string', action.name);
    assert.ok(action.label.length > 0, action.name);
    assert.equal(typeof action.group, 'string', action.name);
    assert.ok(action.group.length > 0, action.name);
    assert.equal(typeof action.help, 'string', action.name);
    assert.ok(action.help.length > 0, action.name);
    assert.equal(typeof action.destructive, 'boolean', action.name);
  }
});

test('only restart-launcher is destructive', () => {
  const destructive = ACTIONS.filter((action) => action.destructive).map((action) => action.name);
  assert.deepEqual(destructive, ['restart-launcher']);
});

test('findAction returns the matching entry and null otherwise', () => {
  assert.equal(findAction('clear-cache').name, 'clear-cache');
  assert.equal(findAction('missing'), null);
  assert.equal(findAction('__proto__'), null);
  assert.equal(findAction('constructor'), null);
  assert.equal(findAction(undefined), null);
  assert.equal(findAction(42), null);
});

test('ACTIONS and its entries are frozen', () => {
  assert.equal(Object.isFrozen(ACTIONS), true);
  assert.equal(Object.isFrozen(ACTIONS[0]), true);
  assert.throws(() => { ACTIONS[0].destructive = true; }, TypeError);
});
