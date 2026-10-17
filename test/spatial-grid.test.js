'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { centredScrollOffset, nextCoordinate, verticalColumn, visibleRange } = require('../src/renderer/spatial-grid');

test('virtual range includes visible items and one buffered column on each side', () => {
  const range = visibleRange(1280, 900, 280, 24, 1000, 96, 1);
  assert.deepEqual(range, { start: 2, end: 8 });
  assert.ok(range.end - range.start < 10);
});

test('virtual range clamps at catalog edges and handles empty rows', () => {
  assert.deepEqual(visibleRange(0, 900, 280, 24, 1000, 96, 1), { start: 0, end: 4 });
  assert.deepEqual(visibleRange(0, 900, 280, 24, 0, 96, 1), { start: 0, end: 0 });
});

test('focused column is centred when possible and clamped at track edges', () => {
  const offset = centredScrollOffset(20, 280, 24, 900, 1000, 96, 96);
  assert.equal(offset, 20 * 304 + 96 + 140 - 450);
  assert.equal(centredScrollOffset(0, 280, 24, 900, 1000, 96, 96), 0);
  assert.equal(centredScrollOffset(999, 280, 24, 900, 1000, 96, 96), 303268);
});

test('vertical movement clamps incomplete rows and remembers preferred column', () => {
  const rows = [
    { items: Array.from({ length: 8 }, (_, id) => ({ id })) },
    { items: Array.from({ length: 3 }, (_, id) => ({ id })) },
    { items: Array.from({ length: 8 }, (_, id) => ({ id })) }
  ];
  assert.deepEqual(nextCoordinate(rows, [0, 6], 6, 'down'), [1, 2]);
  assert.deepEqual(nextCoordinate(rows, [1, 2], 6, 'down'), [2, 6]);
  assert.deepEqual(nextCoordinate(rows, [2, 6], 6, 'up'), [1, 2]);
  assert.equal(verticalColumn(6, 3), 2);
  assert.equal(nextCoordinate(rows, [0, 0], 0, 'up'), null);
});

test('horizontal movement stays on focused row and respects boundaries', () => {
  const rows = [
    { items: [{ id: 'a' }, { id: 'b' }] },
    { items: [{ id: 'c' }] }
  ];
  assert.deepEqual(nextCoordinate(rows, [0, 0], 0, 'right'), [0, 1]);
  assert.equal(nextCoordinate(rows, [0, 1], 1, 'right'), null);
  assert.equal(nextCoordinate(rows, [1, 0], 0, 'left'), null);
});
