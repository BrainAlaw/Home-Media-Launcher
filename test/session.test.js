'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSessionMachine } = require('../src/main/session-machine');
const { createHoldDetector } = require('../src/main/hold-detector');
const { parseEvdevEvents, parseInputDevices, decodeXInputMask, BTN, GuideWatcher } = require('../src/main/guide-watcher');
const { chooseOverlayMode } = require('../src/main/exit-overlay');
const { createController } = require('../src/main/ext/session');
const { ProcessManager } = require('../src/main/process-manager');
const { nextState, computeFlip, springSamples, springEasing } = require('../src/renderer/launch-transition');

/* ------------------------------------------------------------------ state machine */

test('session machine walks idle -> launching -> running -> closing -> idle and reports each change once', () => {
  const seen = [];
  const machine = createSessionMachine({ onChange: (phase) => seen.push(phase) });
  assert.equal(machine.beginLaunch('a', 'App A'), true);
  assert.equal(machine.beginLaunch('b', 'App B'), false, 'second launch is refused while in flight');
  assert.equal(machine.markRunning(), true);
  assert.equal(machine.markRunning(), false);
  assert.equal(machine.beginClosing(), true);
  assert.equal(machine.beginClosing(), false);
  assert.equal(machine.finish(), true);
  assert.equal(machine.finish(), false);
  assert.deepEqual(seen.map((phase) => phase.phase), ['launching', 'running', 'closing', 'idle']);
  assert.deepEqual(seen[1], { phase: 'running', tileId: 'a', name: 'App A' });
});

test('session machine tolerates fast exit and launch failure', () => {
  const machine = createSessionMachine();
  machine.beginLaunch('a', '');
  assert.equal(machine.snapshot().name, 'a');
  assert.equal(machine.beginClosing(), true, 'launching may close directly');
  machine.finish();
  machine.beginLaunch('b', 'B');
  assert.equal(machine.finish(), true, 'failure resets from launching');
  assert.equal(machine.phase, 'idle');
  assert.equal(machine.markRunning(), false);
  assert.equal(machine.beginClosing(), false);
});

/* ------------------------------------------------------------------ hold detector */

test('hold detector shows progress after the delay, completes once and cancels early releases', () => {
  const log = [];
  const detector = createHoldDetector({ holdMs: 700, showAfterMs: 150, onProgress: (p) => log.push(['p', Math.round(p * 100)]), onComplete: () => log.push(['done']), onCancel: () => log.push(['cancel']) });
  detector.update(true, 1000);
  detector.update(true, 1100);
  assert.deepEqual(log, [], 'nothing visible before the show delay');
  detector.update(true, 1350);
  detector.update(false, 1400);
  assert.deepEqual(log, [['p', 50], ['cancel']]);
  log.length = 0;
  detector.update(true, 2000);
  detector.update(true, 2700);
  detector.update(true, 2900);
  detector.update(false, 3000);
  assert.deepEqual(log, [['p', 100], ['done']], 'completes exactly once and a release after completion is not a cancel');
});

/* ------------------------------------------------------------------ guide watcher parsing */

test('evdev events are decoded for 64-bit and 32-bit layouts', () => {
  for (const size of [24, 16]) {
    const buffer = Buffer.alloc(size * 3);
    const write = (index, type, code, value) => {
      const offset = index * size + size - 8;
      buffer.writeUInt16LE(type, offset); buffer.writeUInt16LE(code, offset + 2); buffer.writeInt32LE(value, offset + 4);
    };
    write(0, 1, BTN.MODE, 1);
    write(1, 0, 0, 0); // EV_SYN is ignored
    write(2, 1, BTN.MODE, 0);
    assert.deepEqual(parseEvdevEvents(buffer, buffer.length, size), [{ code: BTN.MODE, value: 1 }, { code: BTN.MODE, value: 0 }]);
  }
});

test('only devices with both js and event handlers are treated as gamepads', () => {
  const text = [
    'I: Bus=0003 Vendor=045e Product=028e Version=0110', 'N: Name="Microsoft X-Box 360 pad"', 'H: Handlers=event12 js0', 'B: EV=20000b', '',
    'I: Bus=0011 Vendor=0001 Product=0001 Version=ab41', 'N: Name="AT Translated Set 2 keyboard"', 'H: Handlers=sysrq kbd event3 leds', 'B: EV=120013', ''
  ].join('\n');
  assert.deepEqual(parseInputDevices(text), [{ name: 'Microsoft X-Box 360 pad', path: '/dev/input/event12' }]);
});

test('XInput mask decodes the guide button and the Moonlight quit chord', () => {
  assert.deepEqual(decodeXInputMask(0x0400), { guide: true, combo: false });
  assert.deepEqual(decodeXInputMask(0x0010 | 0x0020 | 0x0100 | 0x0200), { guide: false, combo: true });
  assert.deepEqual(decodeXInputMask(0), { guide: false, combo: false });
});

test('linux watcher reports a held Guide button from non-blocking evdev reads', () => {
  const size = 24;
  const queue = [];
  const frame = (code, value) => { const buffer = Buffer.alloc(size); const o = size - 8; buffer.writeUInt16LE(1, o); buffer.writeUInt16LE(code, o + 2); buffer.writeInt32LE(value, o + 4); return buffer; };
  const fsApi = {
    constants: { O_RDONLY: 0, O_NONBLOCK: 2048 },
    readFileSync: () => 'N: Name="pad"\nH: Handlers=event5 js0\n',
    openSync: () => 9,
    closeSync: () => {},
    readSync: (_fd, buffer) => {
      const next = queue.shift();
      if (!next) throw Object.assign(new Error('again'), { code: 'EAGAIN' });
      next.copy(buffer); return next.length;
    }
  };
  let clock = 0;
  const watcher = new GuideWatcher({ platform: 'linux', fsApi, now: () => clock, eventSize: size });
  const events = [];
  watcher.on('progress', (p) => events.push(['progress', p]));
  watcher.on('complete', () => events.push(['complete']));
  watcher.scanLinux();
  queue.push(frame(BTN.MODE, 1));
  watcher.readLinux();
  assert.equal(watcher.guide, true);
  for (const time of [0, 200, 400, 800]) { clock = time; watcher.detector.update(watcher.guide, clock); }
  assert.equal(events.at(-1)[0], 'complete');
  queue.push(frame(BTN.MODE, 0));
  watcher.readLinux();
  assert.equal(watcher.guide, false);
});

/* ------------------------------------------------------------------ overlay mode */

test('overlay is replaced by a direct close on native Wayland only', () => {
  assert.equal(chooseOverlayMode({ platform: 'win32' }), 'overlay');
  assert.equal(chooseOverlayMode({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' }, ozonePlatform: '' }), 'overlay');
  assert.equal(chooseOverlayMode({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }, ozonePlatform: '' }), 'direct');
  assert.equal(chooseOverlayMode({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, ozonePlatform: 'x11' }), 'overlay');
  assert.equal(chooseOverlayMode({ platform: 'linux', env: {}, ozonePlatform: 'wayland' }), 'direct');
});

/* ------------------------------------------------------------------ controller */

function harness(extra = {}) {
  const events = [];
  let clock = 0;
  const windowStub = Object.assign(new EventEmitter(), { isDestroyed: () => false, isFocused: () => false });
  const calls = { hide: 0, showLauncher: 0, closeWeb: 0, terminate: 0 };
  const controller = createController({ now: () => clock, delay: async (ms) => { clock += ms; }, createWatcher: () => Object.assign(new EventEmitter(), { start() {}, stop() {} }), ...extra });
  controller.setEmitter((event, payload) => events.push([event, payload]));
  controller.attach({
    getLauncherWindow: () => windowStub,
    processManager: { terminate: () => { calls.terminate += 1; return true; } },
    closeWebWindow: () => { calls.closeWeb += 1; },
    showLauncher: () => { calls.showLauncher += 1; },
    platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' }
  });
  return { controller, events, calls, windowStub, advance: (ms) => { clock += ms; } };
}

test('handoff keeps the launcher until the cover time passed, then hides it and marks running', async () => {
  const { controller, events, calls } = harness();
  assert.equal(controller.begin({ id: 't', name: 'Tile', type: 'website' }), true);
  const handedOff = await controller.handoff({ hide: () => { calls.hide += 1; } });
  assert.equal(handedOff, true);
  assert.equal(calls.hide, 1);
  assert.deepEqual(events.map(([, p]) => p.phase), ['launching', 'running']);
});

test('handoff is abandoned when the application exits first (fast exit / failure)', async () => {
  const { controller, calls } = harness();
  controller.begin({ id: 't', name: 'Tile', type: 'native' });
  controller.closing();
  controller.finish();
  assert.equal(await controller.handoff({ hide: () => { calls.hide += 1; } }), false);
  assert.equal(calls.hide, 0, 'the launcher is never hidden for a session that already ended');
});

test('closeActive closes a web window through its window and a native process through the manager', async () => {
  const web = harness();
  web.controller.begin({ id: 'w', name: 'Web', type: 'website' });
  await web.controller.handoff({ hide() {} });
  assert.equal(await web.controller.closeActive(), true);
  assert.equal(web.calls.closeWeb, 1);

  const native = harness();
  native.controller.begin({ id: 'n', name: 'Native', type: 'native' });
  await native.controller.handoff({ hide() {} });
  assert.equal(await native.controller.closeActive(), true);
  assert.deepEqual([native.calls.showLauncher, native.calls.terminate], [1, 1]);
  assert.equal(native.controller.phase, 'closing');
  assert.equal(await native.controller.closeActive(), true, 'repeated close requests are harmless');
  assert.equal(native.calls.terminate, 1);
  native.controller.finish();
  assert.equal(await native.controller.closeActive(), false);
});

test('begin refuses a second session and fail() returns to idle', () => {
  const { controller } = harness();
  assert.equal(controller.begin({ id: 'a', type: 'native' }), true);
  assert.equal(controller.begin({ id: 'b', type: 'native' }), false);
  controller.fail();
  assert.equal(controller.phase, 'idle');
});

/* ------------------------------------------------------------------ process tree termination */

function managerWith(options) {
  const child = new EventEmitter();
  child.pid = 77;
  const manager = new ProcessManager(() => child, options);
  manager.launch({ id: 'x', command: 'app' });
  return { manager, child };
}

test('terminate signals the POSIX process group and escalates to SIGKILL after the grace period', async () => {
  const signals = [];
  const { manager, child } = managerWith({ platform: 'linux', signalGroup: (pid, signal) => signals.push([pid, signal]) });
  assert.equal(manager.terminate({ graceMs: 20 }), true);
  assert.deepEqual(signals, [[77, 'SIGTERM']]);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(signals, [[77, 'SIGTERM'], [77, 'SIGKILL']]);
  child.emit('exit', null, 'SIGKILL');
});

test('terminate does not escalate when the process exits within the grace period', async () => {
  const signals = [];
  const { manager, child } = managerWith({ platform: 'linux', signalGroup: (pid, signal) => signals.push([pid, signal]) });
  manager.terminate({ graceMs: 30 });
  child.emit('exit', 0, null);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.deepEqual(signals, [[77, 'SIGTERM']]);
});

test('terminate uses taskkill /t on Windows and reports false when nothing runs', () => {
  const killed = [];
  const { manager } = managerWith({ platform: 'win32', killTree: (pid) => killed.push(pid) });
  assert.equal(manager.terminate(), true);
  assert.deepEqual(killed, [77]);
  assert.equal(new ProcessManager().terminate(), false);
});

/* ------------------------------------------------------------------ renderer transition logic */

test('transition state machine covers, reveals and tolerates interruptions', () => {
  assert.equal(nextState('idle', 'cover'), 'covering');
  assert.equal(nextState('covering', 'covered'), 'covered');
  assert.equal(nextState('covering', 'reveal'), 'revealing', 'a failed launch interrupts the expand');
  assert.equal(nextState('covered', 'reveal'), 'revealing');
  assert.equal(nextState('revealing', 'done'), 'idle');
  assert.equal(nextState('idle', 'reveal'), 'idle');
  assert.equal(nextState('revealing', 'cover'), 'covering');
});

test('FLIP geometry maps the tile rectangle onto the viewport', () => {
  const flip = computeFlip({ left: 100, top: 50, width: 480, height: 270 }, { width: 1920, height: 1080 });
  assert.equal(flip.sx, 0.25);
  assert.equal(flip.sy, 0.25);
  assert.equal(flip.transform, 'translate(100px, 50px) scale(0.25, 0.25)');
  assert.equal(computeFlip({ left: 0, top: 0, width: 5000, height: 5000 }, { width: 100, height: 100 }).sx, 1);
});

test('spring samples settle at 1 and produce a CSS linear() easing', () => {
  const { values, durationMs } = springSamples();
  assert.equal(values[0], 0);
  assert.equal(values.at(-1), 1);
  assert.ok(Math.max(...values) > 1, 'underdamped spring overshoots');
  assert.ok(durationMs > 100 && durationMs <= 1600);
  assert.match(springEasing().easing, /^linear\(0, /);
});
