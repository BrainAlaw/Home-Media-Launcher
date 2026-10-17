'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeController, normalizeStatus, normalizeTransport, createMockBackend, resolveBridge, createControllerService } = require('../src/renderer/controller-service');
const { PairingFlow, reduce, INITIAL } = require('../src/renderer/pairing-flow');

/** Manual timer queue so flows can be driven deterministically. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const queue = new Map();
  return {
    setTimeout: (callback, delay) => { const id = nextId++; queue.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: (id) => queue.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, entry] of [...queue].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.at <= now && queue.delete(id)) entry.callback();
      }
    }
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('controllers are normalised from varied backend shapes', () => {
  assert.deepEqual(normalizeController({ id: 7, name: ' Pad ', connection: 'Xbox Wireless Adapter', battery: { percent: 41.6, charging: true } }),
    { id: '7', name: 'Pad', transport: 'dongle', battery: 42, charging: true });
  assert.deepEqual(normalizeController({ transport: 'BLE', battery: 250 }, 3),
    { id: 'controller-3', name: 'Xbox Wireless Controller', transport: 'bluetooth', battery: 100, charging: false });
  assert.equal(normalizeController({ battery: 'n/a' }).battery, null);
  assert.equal(normalizeTransport('wired USB'), 'usb');
  assert.equal(normalizeTransport('???'), 'unknown');
  assert.deepEqual(normalizeStatus([{ id: 'a' }]).controllers.length, 1);
  assert.equal(normalizeStatus({ supported: false, message: 'x', controllers: [] }).supported, false);
  assert.deepEqual(normalizeStatus(undefined), { platform: '', supported: true, message: '', controllers: [] });
});

test('bridge resolution prefers a complete real bridge and falls back to the mock', () => {
  const complete = { getControllerStatus() {}, startControllerPairing() {}, pairController() {} };
  assert.equal(resolveBridge({ launcher: complete }).bridge, complete);
  assert.equal(resolveBridge({ api: complete }).source, 'api');
  assert.equal(resolveBridge({ launcher: { getControllerStatus() {} } }).source, 'mock');
  assert.equal(resolveBridge({ launcher: complete }, '?controllerMock=error').source, 'mock');
  assert.equal(resolveBridge({}).bridge.isMock, true);
});

test('request/response bridges are translated into service events', async () => {
  const bridge = {
    getControllerStatus: async () => ({ platform: 'linux', controllers: [] }),
    startControllerPairing: async () => ({ state: 'complete', transport: 'bluetooth', devices: [{ id: 'd1', name: 'Pad', transport: 'bluetooth' }] }),
    pairController: async () => ({ success: true, controller: { id: 'd1' } })
  };
  const service = createControllerService({ bridge });
  const found = [];
  service.on('deviceFound', (device) => found.push(device));
  await service.startPairing('bluetooth');
  assert.deepEqual(found, [{ id: 'd1', name: 'Pad', transport: 'bluetooth' }]);

  const empty = createControllerService({ bridge: { ...bridge, startControllerPairing: async () => ({ state: 'complete', transport: 'bluetooth', devices: [] }) } });
  const errors = [];
  empty.on('pairingError', (error) => errors.push(error.message));
  await empty.startPairing('bluetooth');
  assert.equal(errors.length, 1);
});

test('USB and dongle status results are not treated as Bluetooth pairing discoveries', async () => {
  const bridge = {
    getControllerStatus: async () => ({ controllers: [{ id: 'usb-1', name: 'Wired Xbox Controller', transport: 'usb' }] }),
    startControllerPairing: async () => ({ state: 'complete', transport: 'usb', devices: [{ id: 'usb-1', name: 'Wired Xbox Controller', transport: 'usb' }] }),
    pairController: async () => { throw new Error('USB controllers are not Bluetooth-paired'); }
  };
  const service = createControllerService({ bridge });
  const found = [];
  const errors = [];
  service.on('deviceFound', (device) => found.push(device));
  service.on('pairingError', (error) => errors.push(error));
  await service.startPairing('usb');
  assert.deepEqual(found, []);
  assert.deepEqual(errors, []);
  assert.equal((await service.getStatus()).controllers[0].transport, 'usb');
});

test('reducer ignores events that do not apply to the current step', () => {
  const opened = reduce(INITIAL, { type: 'open' });
  assert.equal(opened.step, 'instructions');
  assert.equal(reduce(opened, { type: 'success' }).step, 'instructions');
  assert.equal(reduce(opened, { type: 'transport', transport: 'nope' }).transport, 'bluetooth');
  const scanning = reduce(opened, { type: 'begin' });
  assert.equal(reduce(scanning, { type: 'transport', transport: 'usb' }).transport, 'bluetooth');
  assert.equal(reduce(reduce(scanning, { type: 'deviceFound', device: { id: 'x', name: 'X' } }), { type: 'deviceFound', device: { id: 'y' } }).device.id, 'x');
  assert.equal(reduce(scanning, { type: 'retry' }), scanning);
});

function mockFlow(scenario) {
  const timers = fakeTimers();
  const backend = createMockBackend({ scenario, timers, findDelay: 100, pairDelay: 50 });
  const service = createControllerService({ bridge: backend, source: 'mock' });
  const flow = new PairingFlow(service, { timers, searchTimeoutMs: 1000, connectTimeoutMs: 500 });
  const steps = [];
  flow.subscribe((state) => steps.push(`${state.step}${state.phase === 'idle' ? '' : `:${state.phase}`}`));
  return { flow, timers, steps, backend };
}

test('happy path walks instructions -> searching -> connecting -> success', async () => {
  const { flow, timers, steps } = mockFlow('success');
  flow.open('bluetooth');
  flow.begin();
  await flush();
  timers.advance(100);
  await flush();
  timers.advance(50);
  await flush();
  assert.deepEqual(steps, ['instructions', 'scanning:searching', 'scanning:connecting', 'success']);
  assert.equal(flow.state.controller.battery, 100);
});

test('failure is retryable and a flaky backend succeeds on the second attempt', async () => {
  const { flow, timers, steps } = mockFlow('flaky');
  flow.open('bluetooth');
  flow.begin();
  await flush(); timers.advance(100); await flush(); timers.advance(50); await flush();
  assert.equal(flow.state.step, 'error');
  assert.match(flow.state.message, /refused/);
  flow.retry();
  assert.equal(flow.state.step, 'instructions');
  assert.equal(flow.state.transport, 'bluetooth');
  flow.begin();
  await flush(); timers.advance(100); await flush(); timers.advance(50); await flush();
  assert.equal(flow.state.step, 'success');
  assert.equal(steps.filter((step) => step === 'error').length, 1);
});

test('searching times out with a friendly error', async () => {
  const { flow, timers } = mockFlow('empty');
  flow.open();
  flow.begin();
  await flush();
  timers.advance(100);
  await flush();
  assert.equal(flow.state.step, 'error');
  assert.match(flow.state.message, /No controller was found/);
});

test('USB and dongle pairing confirms the OS connection status without invoking Bluetooth pairing', async () => {
  for (const transport of ['usb', 'dongle']) {
    const controller = { id: `${transport}-controller`, name: 'Xbox Controller', transport };
    const service = createControllerService({
      bridge: {
        getControllerStatus: async () => ({ controllers: [controller] }),
        startControllerPairing: async () => ({ state: 'complete', transport, devices: [controller] }),
        pairController: async () => { throw new Error('Bluetooth pairing must not be used for this transport'); }
      }
    });
    const flow = new PairingFlow(service);
    flow.open(transport);
    flow.begin();
    await flush();
    assert.equal(flow.state.step, 'success');
    assert.equal(flow.state.controller.id, controller.id);
  }
});

test('cancel stops discovery, closes, and late backend results are ignored', async () => {
  const { flow, timers, backend } = mockFlow('success');
  let stopped = 0;
  const original = backend.cancelControllerPairing;
  backend.cancelControllerPairing = async () => { stopped += 1; return original(); };
  flow.open();
  flow.begin();
  await flush();
  flow.cancel();
  assert.equal(flow.state.step, 'closed');
  assert.equal(stopped, 1);
  timers.advance(5000);
  await flush();
  assert.equal(flow.state.step, 'closed');
});

test('pushed pairing updates are deduplicated and translated', async () => {
  let push;
  const bridge = {
    getControllerStatus: async () => ({ controllers: [] }),
    startControllerPairing: async () => ({ state: 'scanning', devices: [] }),
    pairController: async () => ({ success: true }),
    onControllerPairingUpdate: (callback) => { push = callback; return () => {}; }
  };
  const service = createControllerService({ bridge });
  const found = [];
  const errors = [];
  service.on('deviceFound', (device) => found.push(device.id));
  service.on('pairingError', (error) => errors.push(error.message));
  await service.startPairing('bluetooth');
  push({ state: 'scanning', transport: 'bluetooth', devices: [{ id: 'a' }] });
  push({ state: 'scanning', transport: 'bluetooth', devices: [{ id: 'a' }, { id: 'b' }] });
  push({ state: 'cancelled', transport: 'bluetooth', devices: [] });
  assert.deepEqual(found, ['a', 'b']);
  assert.deepEqual(errors, []);
  push({ state: 'error', message: 'Bluetooth is off' });
  assert.deepEqual(errors, ['Bluetooth is off']);
  await service.startPairing('bluetooth');
  push({ state: 'scanning', transport: 'bluetooth', devices: [{ id: 'a' }] });
  assert.deepEqual(found, ['a', 'b', 'a']);
});

test('dongle and USB have no discovery: the wizard succeeds when a controller of that transport is detected', async () => {
  const { flow } = mockFlow('success');
  flow.open('dongle');
  flow.begin();
  await flush();
  await flush();
  assert.equal(flow.state.step, 'success');
  assert.equal(flow.state.controller.transport, 'dongle');
});

test('dongle and USB report a helpful error when nothing is detected', async () => {
  const { flow } = mockFlow('success');
  flow.open('usb');
  flow.begin();
  await flush();
  await flush();
  assert.equal(flow.state.step, 'error');
  assert.match(flow.state.message, /No controller was detected|connection/i);
});
