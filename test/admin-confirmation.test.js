'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createConfirmations } = require('../backend/confirmation');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeClock(start = 1000) {
  let time = start;
  return { now: () => time, advance: (ms) => { time += ms; }, set: (ms) => { time = ms; } };
}

test('issue returns a length-character token from the alphabet', () => {
  const clock = makeClock();
  const zeros = createConfirmations({ now: clock.now, randomBytes: (size) => Buffer.alloc(size, 0) });
  const issued = zeros.issue('restart-launcher');
  assert.strictEqual(issued.token, 'A'.repeat(6));
  assert.strictEqual(issued.expiresAt, clock.now() + 60000);

  const sequential = createConfirmations({ now: clock.now, randomBytes: (size) => Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].slice(0, size)) });
  assert.strictEqual(sequential.issue('restart-launcher').token, 'BCDEFG');

  const live = createConfirmations({ now: clock.now });
  const random = live.issue('restart-launcher').token;
  assert.strictEqual(random.length, 6);
  for (const ch of random) assert.ok(ALPHABET.includes(ch), `unexpected character ${ch}`);
});

test('consume succeeds once and fails the second time', () => {
  const clock = makeClock();
  const conf = createConfirmations({ now: clock.now });
  const { token } = conf.issue('restart-launcher');
  assert.strictEqual(conf.consume('restart-launcher', token), true);
  assert.strictEqual(conf.consume('restart-launcher', token), false);
});

test('a wrong token keeps the entry so the right token still works', () => {
  const clock = makeClock();
  const conf = createConfirmations({ now: clock.now, randomBytes: (size) => Buffer.from([1, 2, 3, 4, 5, 6].slice(0, size)) });
  const { token } = conf.issue('restart-launcher');
  assert.strictEqual(conf.consume('restart-launcher', 'ZZZZZZ'), false);
  assert.strictEqual(conf.consume('restart-launcher', token), true);
});

test('a wrong name fails', () => {
  const clock = makeClock();
  const conf = createConfirmations({ now: clock.now });
  const { token } = conf.issue('restart-launcher');
  assert.strictEqual(conf.consume('other-action', token), false);
  assert.strictEqual(conf.consume('restart-launcher', token), true);
});

test('the token is refused at ttlMs and accepted at ttlMs - 1', () => {
  const clock = makeClock(5000);
  const conf = createConfirmations({ now: clock.now });
  const { token, expiresAt } = conf.issue('restart-launcher');

  clock.set(expiresAt - 1); // ttlMs - 1 after issue
  assert.strictEqual(conf.consume('restart-launcher', token), true);

  const second = conf.issue('restart-launcher');
  clock.set(second.expiresAt); // exactly ttlMs after issue
  assert.strictEqual(conf.consume('restart-launcher', second.token), false);
  // the expired entry was deleted, so a retry also fails
  assert.strictEqual(conf.consume('restart-launcher', second.token), false);
});

test('a second issue for the same name invalidates the first token', () => {
  const clock = makeClock();
  let call = 0;
  const seq = () => {
    call += 1;
    return Buffer.alloc(6, call === 1 ? 0 : 1); // first issue AAA, later issues B...
  };
  const conf = createConfirmations({ now: clock.now, randomBytes: seq });
  const first = conf.issue('restart-launcher');
  assert.strictEqual(first.token, 'AAAAAA');
  const second = conf.issue('restart-launcher');
  assert.strictEqual(second.token, 'BBBBBB');
  assert.strictEqual(conf.consume('restart-launcher', first.token), false);
  assert.strictEqual(conf.consume('restart-launcher', second.token), true);
});

test('a non-string token fails', () => {
  const clock = makeClock();
  const conf = createConfirmations({ now: clock.now });
  const { token } = conf.issue('restart-launcher');
  assert.strictEqual(conf.consume('restart-launcher', 123456), false);
  assert.strictEqual(conf.consume('restart-launcher', null), false);
  assert.strictEqual(conf.consume('restart-launcher', undefined), false);
  assert.strictEqual(conf.consume('restart-launcher', Buffer.from(token)), false);
  // entry survives all refusals
  assert.strictEqual(conf.consume('restart-launcher', token), true);
});

test('invalid options throw TypeError', () => {
  for (const ttlMs of [0, -1, 1.5, '60000']) {
    assert.throws(() => createConfirmations({ ttlMs }), TypeError);
  }
  for (const length of [3, 17, 6.5, '6']) {
    assert.throws(() => createConfirmations({ length }), TypeError);
  }
});
