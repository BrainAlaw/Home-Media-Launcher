'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiagnostics } = require('../src/main/admin/diagnostics');

test('diagnostics contains status, redacted log, masked settings and secret names only', () => {
  const secret = 'spotify-live-secret-123';
  const result = buildDiagnostics({
    status: { spotify: { state: 'error', detail: `Auth failed with ${secret}` } },
    logTail: [{ level: 'error', message: `Authorization: Bearer ${secret}` }],
    settings: { spotify: { clientSecret: secret, label: `uses ${secret}` } },
    secretNames: { SPOTIFY_CLIENT_SECRET: secret, WEATHER_API: '' }
  });

  assert.deepEqual(result.secretNames, [
    { name: 'SPOTIFY_CLIENT_SECRET', set: true },
    { name: 'WEATHER_API', set: false }
  ]);
  assert.equal(result.settings.spotify.clientSecret, '<set>');
  const output = JSON.stringify(result);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes('<redacted>'), true);
});

test('diagnostics applies route config masking to nested secret fields', () => {
  const result = buildDiagnostics({ settings: { nested: { apiKey: 'secret', title: 'Living room' } } });
  assert.equal(result.settings.nested.apiKey, '<set>');
  assert.equal(result.settings.nested.title, 'Living room');
});
