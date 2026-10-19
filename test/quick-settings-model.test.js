'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../src/renderer/quick-settings-model');

test('Ethernet entries are informational', () => {
  assert.equal(model.rowKind({ type: 'ethernet', kind: 'action' }), 'info');
});

test('VPN, toggle and action entries are focusable', () => {
  for (const kind of ['vpn', 'toggle', 'action']) {
    assert.equal(model.rowKind({ kind }), 'focusable');
  }
});

test('unknown entry kinds throw a TypeError naming the kind', () => {
  assert.throws(() => model.rowKind({ kind: 'mystery' }), {
    name: 'TypeError',
    message: /mystery/
  });
});

test('rowClass maps informational and focusable entries', () => {
  assert.equal(model.rowClass({ type: 'ethernet', kind: 'action' }), 'qs-info');
  assert.equal(model.rowClass({ kind: 'vpn' }), 'qs-row');
});

test('browser global is exposed when window exists', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/quick-settings-model.js'), 'utf8');
  const context = { window: {}, module: { exports: {} } };
  vm.runInNewContext(source, context);
  assert.equal(context.window.QuickSettingsModel.rowKind({ kind: 'toggle' }), 'focusable');
  assert.equal(context.window.QuickSettingsModel, context.module.exports);
});
