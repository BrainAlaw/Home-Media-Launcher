'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PAIR_CODE_TTL_MS,
  PAIR_LOCK_MS,
  PAIR_RATE_LIMIT,
  SESSION_TTL_MS,
  createAdminAuth
} = require('../src/main/admin/auth');

function makeAuth() {
  let now = 1_000_000;
  let nonce = 0;
  let codeSequence = 41;
  const auth = createAdminAuth({
    now: () => now,
    randomInt: () => ++codeSequence,
    randomBytes: (size) => Buffer.alloc(size, ++nonce)
  });
  return { auth, advance: (milliseconds) => { now += milliseconds; }, current: () => now };
}

test('pair codes are six digits, expire after five minutes, and a new code replaces the old one', () => {
  const { auth, advance, current } = makeAuth();
  const first = auth.createPairCode();
  assert.deepEqual(first, { code: '000042', expiresAt: current() + PAIR_CODE_TTL_MS });
  const second = auth.createPairCode();
  assert.equal(auth.verifyPairCode('client-a', first.code).ok, false);
  assert.equal(auth.verifyPairCode('client-a', second.code).ok, true);
  auth.createPairCode();
  advance(PAIR_CODE_TTL_MS);
  assert.equal(auth.verifyPairCode('client-a', '000042').ok, false);
});

test('five wrong codes lock only that client for sixty seconds and valid codes are consumed', () => {
  const { auth, advance } = makeAuth();
  const { code } = auth.createPairCode();
  for (let attempt = 0; attempt < 4; attempt += 1) assert.equal(auth.verifyPairCode('client-a', '111111').locked, false);
  const fifth = auth.verifyPairCode('client-a', '111111');
  assert.deepEqual(fifth, { ok: false, locked: true, retryAfter: 60 });
  assert.equal(auth.verifyPairCode('client-a', code).locked, true);
  assert.equal(auth.verifyPairCode('client-b', code).ok, true);
  advance(PAIR_LOCK_MS);
  const replacement = auth.createPairCode();
  assert.equal(auth.verifyPairCode('client-a', replacement.code).ok, true);
});

test('pair endpoint rate limit allows ten requests per minute per client address', () => {
  const { auth, advance } = makeAuth();
  for (let request = 0; request < PAIR_RATE_LIMIT; request += 1) assert.equal(auth.takePairRateLimit('a'), 0);
  assert.equal(auth.takePairRateLimit('a'), 60);
  assert.equal(auth.takePairRateLimit('b'), 0);
  advance(60_000);
  assert.equal(auth.takePairRateLimit('a'), 0);
});

test('sessions keep only token hashes, slide for twelve hours, and revoke', () => {
  const { auth, advance, current } = makeAuth();
  const { token, expiresAt } = auth.createSession();
  assert.equal(expiresAt, current() + SESSION_TTL_MS);
  assert.equal(auth.sessions, undefined);
  advance(60_000);
  const renewed = auth.verifySession(token);
  assert.equal(renewed.expiresAt, current() + SESSION_TTL_MS);
  assert.equal(auth.sessionStatus(token).authenticated, true);
  assert.equal(auth.revokeSession(token), true);
  assert.equal(auth.verifySession(token), null);
});

test('expired sessions are rejected', () => {
  const { auth, advance } = makeAuth();
  const { token } = auth.createSession();
  advance(SESSION_TTL_MS);
  assert.equal(auth.verifySession(token), null);
});
