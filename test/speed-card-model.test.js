const test = require('node:test');
const assert = require('node:assert/strict');
const { cardView, fadeOpacity, RESULT_HOLD_MS, FADE_MS } = require('../src/renderer/speed-card-model.js');

test('cardView returns ip while running', () => {
  const speed = { state: 'running', phase: 'download', downMbps: 12.3, upMbps: 0 };
  assert.equal(cardView({ speed, finishedAt: 12345, now: 50000 }), 'ip');
});

test('cardView returns result before the 20 s hold ends', () => {
  const speed = { state: 'done', phase: 'done', downMbps: 54.2, upMbps: 21.7 };
  const finishedAt = 1000;
  assert.equal(cardView({ speed, finishedAt, now: finishedAt + RESULT_HOLD_MS - 1 }), 'result');
});

test('cardView returns fading at the hold boundary, then ip after fade', () => {
  const speed = { state: 'done', phase: 'done', downMbps: 54.2, upMbps: 21.7 };
  const finishedAt = 1000;
  assert.equal(cardView({ speed, finishedAt, now: finishedAt + RESULT_HOLD_MS }), 'fading');
  assert.equal(cardView({ speed, finishedAt, now: finishedAt + RESULT_HOLD_MS + FADE_MS - 1 }), 'fading');
  assert.equal(cardView({ speed, finishedAt, now: finishedAt + RESULT_HOLD_MS + FADE_MS }), 'ip');
});

test('cardView returns result when finishedAt is missing, and ip for error/cancelled', () => {
  const done = { state: 'done', phase: 'done', downMbps: 33, upMbps: 18 };
  assert.equal(cardView({ speed: done, finishedAt: null, now: 20000 }), 'result');
  assert.equal(cardView({ speed: { state: 'error' }, finishedAt: 1000, now: 5000 }), 'ip');
  assert.equal(cardView({ speed: { state: 'cancelled' }, finishedAt: 1000, now: 5000 }), 'ip');
});

test('fadeOpacity and constants match the fade contract', () => {
  assert.equal(RESULT_HOLD_MS, 20000);
  assert.equal(FADE_MS, 600);
  assert.equal(fadeOpacity('result', 0), 1);
  assert.equal(fadeOpacity('ip', 0), 0);
  assert.equal(fadeOpacity('fading', 0), 1);
  assert.equal(fadeOpacity('fading', 300), 0.5);
  assert.equal(fadeOpacity('fading', 600), 0);
});
