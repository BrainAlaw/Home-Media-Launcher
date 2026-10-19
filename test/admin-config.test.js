'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/main/config');

const withAdmin = (admin) => ({ settings: { admin }, rows: [] });

test('admin block is optional', () => {
  assert.doesNotThrow(() => validateConfig({ settings: {}, rows: [] }));
  assert.doesNotThrow(() => validateConfig(withAdmin({ enabled: false })));
});

test('admin block accepts a valid port and bind address', () => {
  assert.doesNotThrow(() => validateConfig(withAdmin({ enabled: true, port: 8787, bindAddress: '192.168.0.196' })));
});

test('admin block rejects bad values with a message that names the key', () => {
  assert.throws(() => validateConfig(withAdmin('yes')), /admin must be an object/);
  assert.throws(() => validateConfig(withAdmin({ enabled: 'true' })), /admin\.enabled/);
  assert.throws(() => validateConfig(withAdmin({ port: 80 })), /admin\.port/);
  assert.throws(() => validateConfig(withAdmin({ port: 8787.5 })), /admin\.port/);
  assert.throws(() => validateConfig(withAdmin({ bindAddress: '0.0.0.0 && rm' })), /admin\.bindAddress/);
});
