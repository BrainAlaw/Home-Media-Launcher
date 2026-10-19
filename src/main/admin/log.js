'use strict';

const { format } = require('node:util');
const { redactText } = require('./redact');

function createLogRing({ capacity = 500, redact = redactText } = {}) {
  const limit = Number.isSafeInteger(capacity) && capacity > 0 ? capacity : 500;
  const entries = [];

  function write(level, message) {
    const record = {
      time: new Date().toISOString(),
      level: String(level || 'log').toLowerCase(),
      message: String(redact(String(message ?? '')))
    };
    entries.push(record);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    return record;
  }

  function tail(n = 100) {
    const requested = Number.isFinite(Number(n)) ? Math.floor(Number(n)) : 1;
    const count = Math.max(1, Math.min(500, requested));
    return entries.slice(-count).map((record) => ({ ...record }));
  }

  function wrap(consoleLike) {
    if (!consoleLike || typeof consoleLike !== 'object') throw new TypeError('A console-like object is required');
    const originals = new Map();
    for (const level of ['log', 'warn', 'error']) {
      if (typeof consoleLike[level] !== 'function') continue;
      const original = consoleLike[level];
      originals.set(level, original);
      const wrapped = function (...args) {
        write(level, format(...args));
        return original.apply(this, args);
      };
      wrapped.__hmlLogWrapper = true;
      consoleLike[level] = wrapped;
    }
    return function restore() {
      for (const [level, original] of originals) {
        if (consoleLike[level]?.__hmlLogWrapper) consoleLike[level] = original;
      }
    };
  }

  return { write, tail, wrap };
}

module.exports = { createLogRing };
