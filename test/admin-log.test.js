'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogRing } = require('../src/main/admin/log');

test('ring keeps only the newest entries in insertion order', () => {
  const ring = createLogRing({ capacity: 2 });
  ring.write('info', 'one');
  ring.write('warn', 'two');
  ring.write('error', 'three');
  assert.deepEqual(ring.tail(2).map((entry) => entry.message), ['two', 'three']);
  assert.equal(ring.tail(2)[0].level, 'warn');
});

test('redaction is applied at write time', () => {
  const ring = createLogRing({ redact: (text) => text.replaceAll('secret', '<redacted>') });
  ring.write('log', 'secret value');
  assert.equal(ring.tail(1)[0].message, '<redacted> value');
});

test('tail clamps the requested count to 1..500', () => {
  const ring = createLogRing({ capacity: 600 });
  for (let index = 0; index < 520; index += 1) ring.write('log', String(index));
  assert.equal(ring.tail(0).length, 1);
  assert.equal(ring.tail(-3).length, 1);
  assert.equal(ring.tail(900).length, 500);
});

test('wrap captures log, warn and error without changing console output', () => {
  const printed = [];
  const consoleLike = Object.fromEntries(['log', 'warn', 'error'].map((level) => [level, (...args) => printed.push([level, ...args])]));
  const ring = createLogRing();
  const restore = ring.wrap(consoleLike);
  consoleLike.log('hello %s', 'world');
  consoleLike.warn('warning');
  consoleLike.error('failure');
  assert.deepEqual(printed, [['log', 'hello %s', 'world'], ['warn', 'warning'], ['error', 'failure']]);
  assert.deepEqual(ring.tail(3).map((entry) => entry.message), ['hello world', 'warning', 'failure']);
  restore();
  assert.equal(consoleLike.log.__hmlLogWrapper, undefined);
});
