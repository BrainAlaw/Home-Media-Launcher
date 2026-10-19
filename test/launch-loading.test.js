'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { waitingProgress, cardModel, WAITING_CEILING } = require('../src/renderer/launch-loading');

test('waiting progress rises monotonically and never reaches the ceiling by itself', () => {
  let previous = -1;
  for (const ms of [0, 100, 500, 1400, 4000, 60000]) {
    const value = waitingProgress(ms);
    assert.ok(value >= previous, `not monotonic at ${ms} ms`);
    assert.ok(value < WAITING_CEILING + 1e-9, 'must stay within the ceiling');
    previous = value;
  }
  assert.equal(waitingProgress(0), 0);
  assert.ok(waitingProgress(60000) > 0.9, 'long waits approach the ceiling');
});

test('waiting progress ignores bad clock values', () => {
  assert.equal(waitingProgress(-50), 0);
  assert.equal(waitingProgress(Number.NaN), 0);
});

test('card model uses the name, an image logo only when the icon is an image', () => {
  assert.deepEqual(cardModel({ name: 'netflix', icon: 'file:///x/netflix.svg' }), { name: 'netflix', initial: 'N', logo: 'file:///x/netflix.svg' });
  assert.deepEqual(cardModel({ name: 'Desktop', icon: '' }), { name: 'Desktop', initial: 'D', logo: '' });
  assert.deepEqual(cardModel({ name: 'Remote', icon: 'remote-session' }), { name: 'Remote', initial: 'R', logo: '' }, 'a bare word is not an image');
  assert.deepEqual(cardModel(null), { name: 'Starting', initial: 'S', logo: '' });
});
