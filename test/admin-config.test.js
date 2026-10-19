'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/main/config');

test('admin block is optional and defaults to disabled', () => {
  assert.doesNotThrow(() => validateConfig({ settings: {}, rows: [] }));
  assert.doesNotThrow(() => validateConfig({ settings: {}, rows: [], admin: { enabled: false } }));
});

test('admin block accepts a valid port and bind address', () => {
  assert.doesNotThrow(() => validateConfig({ settings: {}, rows: [], admin: { enabled: true, port: 8787, bindAddress: '192.168.0.196' } }));
});

test('admin block rejects bad values with a message that names the key', () => {
  const base = { settings: {}, rows: [] };
  assert.throws(() => validateConfig({ ...base, admin: 'yes' }), /admin must be an object/);
  assert.throws(() => validateConfig({ ...base, admin: { enabled: 'true' } }), /admin\.enabled/);
  assert.throws(() => validateConfig({ ...base, admin: { port: 80 } }), /admin\.port/);
  assert.throws(() => validateConfig({ ...base, admin: { port: 8787.5 } }), /admin\.port/);
  assert.throws(() => validateConfig({ ...base, admin: { bindAddress: '0.0.0.0 && rm' } }), /admin\.bindAddress/);
});
