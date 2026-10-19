'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { nearestFocusable, buildTvControlScript, TV_CONTROL_SCRIPT } = require('../backend/tv-controls');
const { TvBrowserSession, isLoopbackDevToolsUrl } = require('../src/main/tv-browser');

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
  assert.match(TV_CONTROL_SCRIPT, /hmlClose/);
  assert.match(TV_CONTROL_SCRIPT, /nearestFocusable/);
  assert.match(TV_CONTROL_SCRIPT, /ArrowRight/);
});


test('TV control script inlines configured remote key names and hold timing', () => {
  const keymap = {
    keys: { RemoteNorth: 'home', RemoteWest: 'back' },
    longKeys: { RemoteWest: 'close' },
    longPressMs: 700,
    buttons: { 16: 'close' },
    exitButtons: [16],
    axisDeadzone: 0.6
  };
  const script = buildTvControlScript(keymap);
  assert.match(script, /"RemoteNorth":"home"/);
  assert.match(script, /"RemoteWest":"close"/);
  assert.match(script, /"longPressMs":700/);
  assert.doesNotMatch(script, /__HML_KEYMAP_JSON__/);
  assert.doesNotThrow(() => new vm.Script(script));
});



test('TV browser hide and show use DevTools window bounds', async () => {
  const browser = new TvBrowserSession({ userData: 'unused' });
  const calls = [];
  browser.connection = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Target.getTargets') return { targetInfos: [{ type: 'page', targetId: 'page-target' }] };
      if (method === 'Browser.getWindowForTarget') return { windowId: 17 };
      return {};
    }
  };

  await browser.hide();
  await browser.show();
  assert.deepEqual(calls, [
    { method: 'Target.getTargets', params: undefined },
    { method: 'Browser.getWindowForTarget', params: { targetId: 'page-target' } },
    { method: 'Browser.setWindowBounds', params: { windowId: 17, bounds: { windowState: 'minimized' } } },
    { method: 'Target.getTargets', params: undefined },
    { method: 'Browser.getWindowForTarget', params: { targetId: 'page-target' } },
    { method: 'Browser.setWindowBounds', params: { windowId: 17, bounds: { windowState: 'fullscreen' } } },
  ]);
});

test('TV browser hide and show reject when the browser has gone', async () => {
  const browser = new TvBrowserSession({ userData: 'unused' });
  await assert.rejects(browser.hide(), /TV browser is not running/);
  browser.connection = { async send() { return { targetInfos: [] }; } };
  await assert.rejects(browser.show(), /TV browser window is unavailable/);
});

test('TV browser emits home and close from DevTools bindings', () => {
  const browser = new TvBrowserSession({ userData: 'unused' });
  const events = [];
  browser.on('home', () => events.push('home'));
  browser.on('close', (reason) => events.push(`close:${reason}`));
  browser.onDevToolsEvent({ method: 'Runtime.bindingCalled', params: { name: 'hmlHome' } });
  browser.onDevToolsEvent({ method: 'Runtime.bindingCalled', params: { name: 'hmlClose', payload: 'hold' } });
  assert.deepEqual(events, ['home', 'close:hold']);
});
