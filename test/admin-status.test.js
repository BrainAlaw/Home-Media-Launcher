'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { probe, buildStatus, STATUS_SOURCES } = require('../src/main/admin/status');

test('a probe that never resolves returns unknown after its timeout', async () => {
  const result = await probe('host', () => new Promise(() => {}), 10);
  assert.deepEqual(result, { state: 'unknown', detail: 'Probe timed out' });
});

test('a throwing probe returns an error with a short safe message', async () => {
  const result = await probe('host', () => { throw new Error('Bearer top-secret-token'); }, 100, ['top-secret-token']);
  assert.equal(result.state, 'error');
  assert.equal(result.detail, 'Bearer <redacted>');
});

test('buildStatus probes every source and removes secret-like fields and values', async () => {
  const sources = Object.fromEntries(STATUS_SOURCES.map((name) => [name, async () => ({
    online: true,
    token: 'token-value',
    apiKey: 'key-value',
    ssid: 'private-wifi',
    message: 'Bearer raw-bearer-secret and api=raw-api-secret'
  })]));
  sources.secretValues = ['raw-bearer-secret', 'raw-api-secret'];
  const result = await buildStatus(sources);
  assert.deepEqual(Object.keys(result), STATUS_SOURCES);
  assert.equal(result.host.state, 'ok');
  const serialised = JSON.stringify(result);
  for (const secret of ['token-value', 'key-value', 'private-wifi', 'raw-bearer-secret', 'raw-api-secret']) {
    assert.equal(serialised.includes(secret), false);
  }
  assert.equal(/"[^"']*(?:token|secret|key|ssid)[^"']*"\s*:/i.test(serialised), false);
});

test('buildStatus reports missing probes as unknown', async () => {
  const result = await buildStatus({});
  assert.equal(result.weather.state, 'unknown');
});
