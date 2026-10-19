'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wheelToHorizontal, clickAction } = require('../src/renderer/mouse-mode-model');

test('wheel delta maps vertical movement to the horizontal track', () => {
  assert.equal(wheelToHorizontal({ deltaY: 24 }), 24);
  assert.equal(wheelToHorizontal({ deltaX: -12 }), -12);
  assert.equal(wheelToHorizontal({ deltaX: 0, deltaY: 0 }), 0);
});

test('click action activates buttons and pointer targets only', () => {
  const button = { tagName: 'BUTTON' };
  const pointerTarget = { tagName: 'DIV', classList: { contains: (name) => name === 'pointer-target' } };
  const plainText = { tagName: 'SPAN', classList: { contains: () => false } };
  assert.equal(clickAction(button), 'activate');
  assert.equal(clickAction(pointerTarget), 'activate');
  assert.equal(clickAction(plainText), null);
});
