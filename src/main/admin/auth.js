'use strict';

const crypto = require('node:crypto');

const PAIR_CODE_TTL_MS = 5 * 60 * 1000;
const PAIR_LOCK_MS = 60 * 1000;
const PAIR_MAX_ATTEMPTS = 5;
const PAIR_RATE_WINDOW_MS = 60 * 1000;
const PAIR_RATE_LIMIT = 10;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PAIR_CODE_LENGTH = 6;
const PAIR_CODE_PATTERN = /^\d{6}$/;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeCodeMatch(expected, candidate) {
  const expectedBytes = Buffer.from(expected || '000000', 'ascii');
  const candidateBytes = Buffer.alloc(PAIR_CODE_LENGTH);
  const validShape = typeof candidate === 'string' && PAIR_CODE_PATTERN.test(candidate);
  if (validShape) Buffer.from(candidate, 'ascii').copy(candidateBytes);
  return crypto.timingSafeEqual(expectedBytes, candidateBytes) && validShape;
}

function createAdminAuth({ now = Date.now, randomInt = crypto.randomInt, randomBytes = crypto.randomBytes } = {}) {
  let pairing = null;
  const attemptsByAddress = new Map();
  const pairRequestsByAddress = new Map();
  const sessions = new Map();

  function createPairCode() {
    const code = String(randomInt(0, 1_000_000)).padStart(PAIR_CODE_LENGTH, '0');
    const expiresAt = now() + PAIR_CODE_TTL_MS;
    pairing = { code, expiresAt };
    return { code, expiresAt };
  }

  function takePairRateLimit(address) {
    const client = String(address || 'unknown');
    const timestamp = now();
    const recent = (pairRequestsByAddress.get(client) || []).filter((entry) => entry > timestamp - PAIR_RATE_WINDOW_MS);
    if (recent.length >= PAIR_RATE_LIMIT) {
      pairRequestsByAddress.set(client, recent);
      return Math.max(1, Math.ceil((recent[0] + PAIR_RATE_WINDOW_MS - timestamp) / 1000));
    }
    recent.push(timestamp);
    pairRequestsByAddress.set(client, recent);
    return 0;
  }

  function verifyPairCode(address, candidate) {
    const client = String(address || 'unknown');
    const timestamp = now();
    let attempts = attemptsByAddress.get(client);
    if (attempts?.lockedUntil > timestamp) {
      return { ok: false, locked: true, retryAfter: Math.max(1, Math.ceil((attempts.lockedUntil - timestamp) / 1000)) };
    }
    if (attempts?.lockedUntil && attempts.lockedUntil <= timestamp) {
      attemptsByAddress.delete(client);
      attempts = null;
    }

    const activeCode = pairing && pairing.expiresAt > timestamp ? pairing : null;
    if (pairing && !activeCode) pairing = null;
    const matches = safeCodeMatch(activeCode?.code, candidate);
    if (matches && activeCode) {
      pairing = null;
      attemptsByAddress.delete(client);
      return { ok: true, locked: false, retryAfter: 0 };
    }

    const next = { count: (attempts?.count || 0) + 1, lockedUntil: 0 };
    if (next.count >= PAIR_MAX_ATTEMPTS) next.lockedUntil = timestamp + PAIR_LOCK_MS;
    attemptsByAddress.set(client, next);
    return {
      ok: false,
      locked: next.lockedUntil > timestamp,
      retryAfter: next.lockedUntil > timestamp ? Math.ceil(PAIR_LOCK_MS / 1000) : 0
    };
  }

  function createSession() {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now() + SESSION_TTL_MS;
    sessions.set(digest(token), { expiresAt });
    return { token, expiresAt };
  }

  function verifySession(token) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 64) return null;
    const tokenHash = digest(token);
    const session = sessions.get(tokenHash);
    if (!session) return null;
    const timestamp = now();
    if (session.expiresAt <= timestamp) {
      sessions.delete(tokenHash);
      return null;
    }
    session.expiresAt = timestamp + SESSION_TTL_MS;
    return { expiresAt: session.expiresAt };
  }

  function revokeSession(token) {
    if (typeof token !== 'string' || token.length < 40 || token.length > 64) return false;
    return sessions.delete(digest(token));
  }

  function sessionStatus(token) {
    const session = verifySession(token);
    return session ? { authenticated: true, expiresAt: session.expiresAt } : { authenticated: false, expiresAt: null };
  }

  return { createPairCode, verifyPairCode, takePairRateLimit, createSession, verifySession, revokeSession, sessionStatus };
}

module.exports = {
  PAIR_CODE_TTL_MS,
  PAIR_LOCK_MS,
  PAIR_MAX_ATTEMPTS,
  PAIR_RATE_WINDOW_MS,
  PAIR_RATE_LIMIT,
  SESSION_TTL_MS,
  createAdminAuth
};
