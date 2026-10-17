'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { accentFromPixels, accentCss } = require('../src/renderer/tile-accent');

const fill = (rgba, count = 64) => Uint8ClampedArray.from(Array.from({ length: count }, () => rgba).flat());

test('accent follows the dominant saturated colour and ignores backgrounds', () => {
  const red = accentFromPixels(Uint8ClampedArray.from([...fill([220, 20, 30, 255], 20), ...fill([0, 0, 0, 255], 40), ...fill([255, 255, 255, 255], 40)]));
  assert.ok(red && (red.hue <= 5 || red.hue >= 354), `red hue ${red?.hue}`);
  const blue = accentFromPixels(fill([20, 60, 230, 255]));
  assert.ok(blue && Math.abs(blue.hue - 226) <= 4, `blue hue ${blue?.hue}`);
});

test('monochrome and transparent art yields no accent', () => {
  assert.equal(accentFromPixels(fill([128, 128, 128, 255])), null);
  assert.equal(accentFromPixels(fill([200, 20, 20, 0])), null);
});

test('accent css is clamped to a readable saturation', () => {
  assert.equal(accentCss({ hue: 10, saturation: 0.1 }), 'hsl(10 55% 56%)');
  assert.equal(accentCss({ hue: 200, saturation: 1 }), 'hsl(200 85% 56%)');
});
