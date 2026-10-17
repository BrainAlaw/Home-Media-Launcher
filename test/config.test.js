'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/main/config');

test('accepts safe argv tile configuration', () => {
  const config = { rows: [{ title: 'Games', tiles: [{ name: 'Moonlight', command: 'moonlight-qt', args: ['stream', 'host'] }] }] };
  assert.equal(validateConfig(config), config);
});

test('rejects tile without command', () => {
  assert.throws(() => validateConfig({ rows: [{ title: 'Bad', tiles: [{ name: 'Missing' }] }] }), /command is required/);
});

test('rejects non-string arguments', () => {
  assert.throws(() => validateConfig({ rows: [{ title: 'Bad', tiles: [{ name: 'Bad', command: 'app', args: [1] }] }] }), /array of strings/);
});

test('accepts HTTPS website tiles', () => {
  const config = { rows: [], websites: [{ name: 'Video', url: 'https://example.com/tv' }] };
  assert.equal(validateConfig(config), config);
});

test('rejects executable URL schemes for website tiles', () => {
  assert.throws(() => validateConfig({ rows: [], websites: [{ name: 'Unsafe', url: 'javascript:alert(1)' }] }), /HTTP or HTTPS/);
});
