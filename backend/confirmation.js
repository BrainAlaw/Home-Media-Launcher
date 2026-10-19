'use strict';

// Single-use confirmation tokens for destructive admin actions (e.g. restart-launcher).
// Clock and random source are injected so the logic stays pure and testable.
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I; 32 divides 256, so byte % 32 is unbiased.

function createConfirmations({ now = () => Date.now(), randomBytes = require('node:crypto').randomBytes, ttlMs = 60000, length = 6 } = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new TypeError('ttlMs must be a positive integer');
  if (!Number.isInteger(length) || length < 4 || length > 16) throw new TypeError('length must be an integer from 4 to 16');

  const entries = new Map();

  function dropExpired() {
    const time = now();
    for (const [name, entry] of entries) if (entry.expiresAt <= time) entries.delete(name);
  }

  function issue(name) {
    dropExpired();
    const bytes = randomBytes(length);
    let token = '';
    for (let i = 0; i < length; i += 1) token += ALPHABET[bytes[i] % 32];
    const expiresAt = now() + ttlMs;
    entries.set(name, { token, expiresAt }); // replaces any earlier token for this name
    return { token, expiresAt };
  }

  function consume(name, token) {
    if (typeof token !== 'string') return false;
    const entry = entries.get(name);
    if (!entry) return false;
    if (entry.expiresAt <= now()) {
      entries.delete(name);
      return false;
    }
    const expected = Buffer.from(entry.token, 'ascii');
    const actual = Buffer.from(token, 'ascii');
    if (expected.length !== actual.length) return false;
    if (!crypto.timingSafeEqual(expected, actual)) return false; // mismatch keeps the entry
    entries.delete(name);
    return true;
  }

  return { issue, consume };
}

module.exports = { createConfirmations };
