'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatCode, secondsLeft, countdownText, panelUrl } = require('../src/renderer/admin-pairing');

test('code is shown in two groups of three digits', () => {
  assert.equal(formatCode('123456'), '123 456');
  assert.equal(formatCode('12a34-5'), '12345', 'non-digits are dropped; a wrong length is returned as digits only');
});

test('countdown rounds up and never goes negative', () => {
  assert.equal(secondsLeft(10_000, 4_500), 6);
  assert.equal(secondsLeft(10_000, 10_000), 0);
  assert.equal(secondsLeft(10_000, 20_000), 0);
  assert.equal(secondsLeft(Number.NaN, 0), 0);
});

test('countdown text is m:ss', () => {
  assert.equal(countdownText(300), '5:00');
  assert.equal(countdownText(65), '1:05');
  assert.equal(countdownText(-4), '0:00');
});

test('panel URL uses http and the bound address and port', () => {
  assert.equal(panelUrl('192.168.0.196', 8787), 'http://192.168.0.196:8787');
});
