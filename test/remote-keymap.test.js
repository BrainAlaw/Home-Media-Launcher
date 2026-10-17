'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveKey, repeatInterval, RemoteKeyTracker, TIMING } = require('../src/renderer/remote-keymap');
const { parseProcInputDevices } = require('../src/main/ext/input');

function harness() {
  let now = 0;
  const timers = [];
  const out = [];
  const tracker = new RemoteKeyTracker({
    emit: (event) => out.push(`${event.action}${event.long ? ':long' : ''}`),
    setTimer: (callback, ms) => { const timer = { at: now + ms, callback }; timers.push(timer); return timer; },
    clearTimer: (timer) => { const i = timers.indexOf(timer); if (i >= 0) timers.splice(i, 1); }
  });
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > end) break;
      const timer = timers.shift();
      now = timer.at;
      timer.callback();
    }
    now = end;
  };
  return { tracker, out, advance };
}

test('maps standard and remote-specific keys', () => {
  assert.equal(resolveKey({ key: 'ArrowUp' }).action, 'up');
  assert.equal(resolveKey({ key: 'NumpadEnter' }).action, 'select');
  assert.equal(resolveKey({ key: 'BrowserBack' }).action, 'back');
  assert.equal(resolveKey({ key: 'Unidentified', code: 'BrowserHome' }).action, 'home');
  assert.equal(resolveKey({ key: 'MediaPlay' }).action, 'playpause');
  assert.equal(resolveKey({ key: 'ChannelDown' }).action, 'pagedown');
  assert.equal(resolveKey({ key: 'ColorF0Red' }).action, 'red');
  assert.equal(resolveKey({ key: 'a' }), null);
});

test('volume keys pass through', () => {
  assert.deepEqual(resolveKey({ key: 'AudioVolumeUp' }), { passthrough: true });
  assert.deepEqual(resolveKey({ key: 'Unidentified', code: 'AudioVolumeMute' }), { passthrough: true });
});

test('Android keycodes work only for unidentified keys', () => {
  assert.equal(resolveKey({ key: 'Unidentified', code: '', keyCode: 4 }).action, 'back');
  assert.equal(resolveKey({ key: 'Unidentified', keyCode: 82 }).action, 'menu');
  assert.equal(resolveKey({ key: 'Unidentified', keyCode: 3 }).action, 'home');
  assert.equal(resolveKey({ key: 'Unidentified', keyCode: 23 }).action, 'select');
  assert.equal(resolveKey({ key: 'Unidentified', keyCode: 85 }).action, 'playpause');
  assert.equal(resolveKey({ key: 'Unidentified', keyCode: 127 }).action, 'playpause');
  assert.equal(resolveKey({ key: 'x', keyCode: 4 }), null);
});

test('repeat interval accelerates on long holds', () => {
  assert.equal(repeatInterval(0), 90);
  assert.ok(repeatInterval(10) < 90);
  assert.ok(repeatInterval(30) < repeatInterval(10));
});

test('direction: immediate, delayed repeat, stops on release', () => {
  const { tracker, out, advance } = harness();
  assert.equal(tracker.keyDown({ key: 'ArrowRight', code: 'ArrowRight' }), true);
  assert.deepEqual(out, ['right']);
  tracker.keyDown({ key: 'ArrowRight', code: 'ArrowRight', repeat: true });
  advance(TIMING.initialDelayMs - 1);
  assert.equal(out.length, 1);
  advance(1);
  assert.equal(out.length, 2);
  advance(90);
  assert.equal(out.length, 3);
  tracker.keyUp({ key: 'ArrowRight', code: 'ArrowRight' });
  advance(1000);
  assert.equal(out.length, 3);
});

test('select: tap emits select on release, hold emits context once', () => {
  let h = harness();
  h.tracker.keyDown({ key: 'Enter', code: 'Enter' });
  h.advance(200);
  h.tracker.keyUp({ key: 'Enter', code: 'Enter' });
  assert.deepEqual(h.out, ['select']);

  h = harness();
  h.tracker.keyDown({ key: 'Enter', code: 'Enter' });
  h.advance(TIMING.longPressMs);
  assert.deepEqual(h.out, ['context:long']);
  h.tracker.keyUp({ key: 'Enter', code: 'Enter' });
  h.advance(2000);
  assert.deepEqual(h.out, ['context:long']);
});

test('home: android keycode taps and holds; plain Home/Super keys are not remote Home', () => {
  let h = harness();
  const home = { key: 'Unidentified', code: '', keyCode: 3 };
  assert.equal(h.tracker.keyDown(home), true);
  h.advance(600);
  h.tracker.keyUp(home);
  assert.deepEqual(h.out, ['home:long']);

  h = harness();
  for (const key of ['Meta', 'Home']) {
    assert.equal(h.tracker.keyDown({ key, code: key }), false);
    h.tracker.keyUp({ key, code: key });
  }
  assert.deepEqual(h.out, []);
});

test('once keys ignore OS auto-repeat; releaseAll cancels timers', () => {
  const { tracker, out, advance } = harness();
  tracker.keyDown({ key: 'BrowserBack', code: 'BrowserBack' });
  tracker.keyDown({ key: 'BrowserBack', code: 'BrowserBack', repeat: true });
  assert.deepEqual(out, ['back']);
  tracker.keyDown({ key: 'ArrowDown', code: 'ArrowDown' });
  tracker.releaseAll();
  advance(2000);
  assert.deepEqual(out, ['back', 'down']);
});

test('modifier combos and unmapped keys are not consumed', () => {
  const { tracker, out } = harness();
  assert.equal(tracker.keyDown({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }), false);
  assert.equal(tracker.keyDown({ key: 'q', code: 'KeyQ' }), false);
  assert.deepEqual(out, []);
});

test('parses remote devices from /proc/bus/input/devices', () => {
  const text = `I: Bus=0005 Vendor=1949 Product=0041 Version=0001
N: Name="Fire TV Remote"
P: Phys=aa:bb:cc:dd:ee:ff
U: Uniq=11:22:33:44:55:66
H: Handlers=sysrq kbd event7

I: Bus=0005 Vendor=1949 Product=0041 Version=0001
N: Name="Fire TV Remote Consumer Control"
U: Uniq=11:22:33:44:55:66
H: Handlers=kbd event8

I: Bus=0003 Vendor=046d Product=c52b Version=0111
N: Name="Logitech USB Keyboard"
H: Handlers=sysrq kbd event3

I: Bus=0003 Vendor=1234 Product=5678 Version=0100
N: Name="2.4G Air Mouse Remote"
H: Handlers=kbd mouse1 event9
`;
  const devices = parseProcInputDevices(text);
  assert.equal(devices.length, 2);
  assert.deepEqual(devices[0], { id: 'bluetooth:11:22:33:44:55:66', name: 'Fire TV Remote', bus: 'bluetooth', address: '11:22:33:44:55:66', handlers: ['sysrq', 'kbd', 'event7', 'event8'] });
  assert.equal(devices[1].bus, 'usb');
  assert.deepEqual(parseProcInputDevices(''), []);
});
