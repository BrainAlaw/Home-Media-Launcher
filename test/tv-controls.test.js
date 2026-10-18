'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { nearestFocusable, TV_CONTROL_SCRIPT } = require('../backend/tv-controls');
const { isLoopbackDevToolsUrl } = require('../src/main/tv-browser');

const rect = (left, top, width = 40, height = 40) => ({ left, top, width, height });

test('TV focus navigation chooses the nearest candidate in the requested direction', () => {
  const origin = rect(100, 100);
  const candidates = [rect(100, 160), rect(160, 102), rect(40, 102), rect(106, 35), rect(104, 104)];
  assert.equal(nearestFocusable(origin, candidates, 'down'), 0);
  assert.equal(nearestFocusable(origin, candidates, 'right'), 1);
  assert.equal(nearestFocusable(origin, candidates, 'left'), 2);
  assert.equal(nearestFocusable(origin, candidates, 'up'), 3);
  assert.equal(nearestFocusable(origin, candidates, 'diagonal'), -1);
});

test('TV browser accepts only the browser debugging socket on its loopback port', () => {
  assert.equal(isLoopbackDevToolsUrl('ws://127.0.0.1:9222/devtools/browser/a', 9222), true);
  assert.equal(isLoopbackDevToolsUrl('ws://localhost:9222/devtools/browser/a', 9222), true);
  assert.equal(isLoopbackDevToolsUrl('ws://10.0.0.5:9222/devtools/browser/a', 9222), false);
  assert.equal(isLoopbackDevToolsUrl('ws://127.0.0.1:9223/devtools/browser/a', 9222), false);
  assert.equal(isLoopbackDevToolsUrl('https://127.0.0.1:9222/devtools/browser/a', 9222), false);
});

test('TV page controls are valid standalone JavaScript for browser document injection', () => {
  assert.doesNotThrow(() => new vm.Script(TV_CONTROL_SCRIPT));
  assert.match(TV_CONTROL_SCRIPT, /hmlTvClose/);
  assert.match(TV_CONTROL_SCRIPT, /nearestFocusable/);
  assert.match(TV_CONTROL_SCRIPT, /ArrowRight/);
});
