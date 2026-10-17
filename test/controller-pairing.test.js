'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  ControllerPairing,
  parseBluetoothDevices,
  parseInputDevices,
  parseWindowsDevices,
  validateTransport,
  WINDOWS_ENUM_SCRIPT
} = require('../src/main/controller-pairing');

const MAC = 'AA:BB:CC:DD:EE:FF';
const { WINDOWS_RADIO_SCRIPT, WINDOWS_DONGLE_SCRIPT } = require('../src/main/controller-session');
const { LinuxControllerHardware } = require('../src/main/controller-hardware');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const healthy = (command, args) => ({ stdout: command === 'rfkill' ? 'Soft blocked: no\nHard blocked: no' :
  args[0] === 'list' ? `Controller ${MAC} Radio` : args[0] === 'show' ? 'Powered: yes' :
    args[0] === 'pair' ? 'Pairing successful' : args[0] === 'trust' ? 'trust succeeded' :
      args[0] === 'connect' ? 'Connection successful' : args[0] === 'info' ? 'Name: Xbox Wireless Controller\nPaired: yes\nTrusted: yes\nConnected: yes' : '' });
function fakeChild() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.writes = []; child.stdin = { write: (text) => child.writes.push(text) };
  child.kill = (signal) => { child.killed = true; child.signal = signal; }; return child;
}
const emptyHardware = { dongles: async () => ({ present: false, driver: null, pairingSupported: false, interfaces: [] }), enrich: async () => new Map() };

test('parses only recognised Bluetooth controllers and deduplicates IDs', () => {
  const devices = parseBluetoothDevices([
    `[NEW] Device ${MAC} Xbox Wireless Controller`,
    `Device ${MAC} Xbox Wireless Controller`,
    'Device 11:22:33:44:55:66 Phone'
  ].join('\n'));
  assert.deepEqual(devices, [{
    id: MAC, name: 'Xbox Wireless Controller', transport: 'bluetooth', battery: null, charging: false, connected: false
  }]);
});

test('parses connected Linux input controllers with stable safe IDs', () => {
  const input = [
    'I: Bus=0003 Vendor=045e Product=02ff Version=0111',
    'N: Name="Microsoft Xbox Controller"',
    'S: Sysfs=/devices/usb1/input/input7',
    'H: Handlers=event7 js0'
  ].join('\n');
  const [first] = parseInputDevices(input);
  const [second] = parseInputDevices(input);
  assert.equal(first.transport, 'usb');
  assert.equal(first.connected, true);
  assert.match(first.id, /^linux:[a-f0-9]{64}$/);
  assert.equal(first.id, second.id);
});

test('recognises the Xbox wireless adapter transport from its USB hardware ID', () => {
  const [device] = parseInputDevices([
    'I: Bus=0003 Vendor=045e Product=02e6 Version=0001',
    'N: Name="Xbox Wireless Controller"',
    'S: Sysfs=/devices/usb1/input/input8',
    'H: Handlers=event8 js0'
  ].join('\n'));
  assert.equal(device.transport, 'dongle');
});

test('Windows controller IDs are hashed and transports are inferred without exposing PnP IDs', () => {
  const [device] = parseWindowsDevices(JSON.stringify({
    Name: 'Xbox Wireless Controller',
    InstanceId: 'BTHENUM\\DEVICE_ABC',
    Status: 'OK'
  }));
  assert.match(device.id, /^win:[a-f0-9]{64}$/);
  assert.equal(device.transport, 'bluetooth');
  assert.equal(device.connected, true);
  assert.equal(device.id.includes('BTHENUM'), false);
});

test('status reports connected Linux devices and only pairs input devices with Bluetooth discovery', async () => {
  const pairing = new ControllerPairing({
    platform: 'linux',
    run: async () => ({ stdout: `Device ${MAC} Xbox Wireless Controller` }),
    readFile: async () => [
      'I: Bus=0005 Vendor=045e Product=02fd Version=0001',
      'N: Name="Xbox Wireless Controller"',
      'U: Uniq=aa:bb:cc:dd:ee:ff',
      'S: Sysfs=/devices/virtual/input/input1',
      'H: Handlers=event1 js0'
    ].join('\n')
  });
  const status = await pairing.getStatus();
  assert.equal(status.platform, 'linux');
  assert.equal(status.supported, true);
  assert.deepEqual(status.controllers.map(({ id, connected, transport }) => ({ id, connected, transport })), [
    { id: MAC, connected: true, transport: 'bluetooth' }
  ]);
});

test('Linux Bluetooth scan is asynchronous, emits discoveries, and cancels cleanly', async () => {
  const child = fakeChild();
  const commands = [];
  const updates = [];
  const pairing = new ControllerPairing({
    platform: 'linux',
    spawn: () => child,
    run: async (command, args) => { commands.push(args); return args[0] === 'info' ? { stdout: 'Paired: no' } : healthy(command, args); },
    emit: (update) => updates.push(update),
    scanTimeoutMs: 10000
  });

  const started = await pairing.start('bluetooth');
  assert.equal(started.state, 'scanning');
  child.stdout.write(`Device ${MAC} Xbox Wireless Controller\n`);
  await tick();
  assert.equal(updates.at(-1).devices[0].id, MAC);
  assert.deepEqual(await pairing.cancel(), { cancelled: true });
  assert.equal(child.killed, true);
  assert.ok(child.writes.includes('scan off\nquit\n'));
  assert.equal(commands.some((args) => args.join(' ') === 'scan off'), true);
  assert.equal(updates.at(-1).state, 'cancelled');
});

test('Linux pairing requires a MAC ID and verifies the paired state', async () => {
  const commands = [];
  const pairing = new ControllerPairing({
    platform: 'linux',
    run: async (command, args) => {
      commands.push(args);
      return healthy(command, args);
    }
  });
  assert.equal((await pairing.pair('arbitrary; command')).success, false);
  assert.equal(commands.length, 0);
  const paired = await pairing.pair(MAC);
  assert.equal(paired.success, true);
  assert.equal(paired.controller.charging, false);
  assert.deepEqual(commands, [['pair', MAC], ['trust', MAC], ['connect', MAC], ['info', MAC]]);
});

test('Linux pairing is not reported successful when bluetoothctl cannot verify Paired: yes', async () => {
  const updates = [];
  const pairing = new ControllerPairing({
    platform: 'linux',
    run: async (command, args) => args[0] === 'info' ? { stdout: `Device ${MAC}\n\tPaired: no\n` } : healthy(command, args),
    emit: (update) => updates.push(update)
  });
  assert.equal((await pairing.pair(MAC)).code, 'PAIR_FAILED');
  assert.equal(updates.at(-1).state, 'error');
});

test('Windows Bluetooth initiation opens the fixed OS pairing affordance', async () => {
  const opened = [];
  const pairing = new ControllerPairing({
    platform: 'win32',
    openSettings: async (url) => opened.push(url),
    run: async (_command, args) => ({ stdout: args.at(-1) === WINDOWS_RADIO_SCRIPT ? '[{"Disabled":false}]' : '[]' })
  });
  const result = await pairing.start('bluetooth');
  assert.equal(result.state, 'scanning');
  assert.deepEqual(opened, ['ms-settings:bluetooth']);
  assert.deepEqual(await pairing.cancel(), { cancelled: true });
});

test('Windows dongle pairing opens connected-device settings and waits for a new controller', async () => {
  const opened = [];
  const pairing = new ControllerPairing({
    platform: 'win32',
    openSettings: async (url) => opened.push(url),
    run: async (_command, args) => ({
      stdout: args.at(-1) === WINDOWS_DONGLE_SCRIPT ? '{"Present":true}' : '[]'
    })
  });
  const result = await pairing.start('dongle');
  assert.equal(result.state, 'scanning');
  assert.deepEqual(opened, ['ms-settings:connecteddevices']);
  await pairing.cancel();
});

test('status polling stops and reports controller enumeration errors', async () => {
  let enumerations = 0;
  const updates = [];
  const pairing = new ControllerPairing({
    platform: 'win32',
    run: async (_command, args) => {
      if (args.at(-1) === WINDOWS_ENUM_SCRIPT && ++enumerations > 1) {
        throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
      }
      return { stdout: '[]' };
    },
    emit: (update) => updates.push(update)
  });
  assert.equal((await pairing.start('usb')).state, 'scanning');
  await pairing.pollWindowsScan(pairing.scan);
  assert.equal(pairing.scan, null);
  assert.equal(updates.at(-1).code, 'PERMISSION_DENIED');
});

test('Windows discovery does not report an already-connected controller as a new pairing result', async () => {
  const updates = [];
  const powershellResult = JSON.stringify({
    Name: 'Xbox Wireless Controller',
    InstanceId: 'BTHENUM\\DEV_001122334455',
    Status: 'OK'
  });
  const pairing = new ControllerPairing({
    platform: 'win32',
    openSettings: async () => {},
    run: async (_command, args) => ({ stdout: args.at(-1) === WINDOWS_RADIO_SCRIPT ? '[{"Disabled":false}]' : powershellResult }),
    emit: (update) => updates.push(update)
  });
  const result = await pairing.start('bluetooth');
  assert.deepEqual(result.devices, []);
  await pairing.pollWindowsScan(pairing.scan);
  assert.deepEqual(updates.at(-1).devices, []);
  await pairing.cancel();
});

test('Linux dongle checks diagnose a missing xone driver without installing anything', async () => {
  const commands = [];
  const pairing = new ControllerPairing({
    platform: 'linux',
    run: async (command, args) => {
      commands.push([command, args]);
      if (command === 'lsusb') return { stdout: 'Bus 001 Device 002: ID 045e:02e6 Microsoft Xbox Wireless Adapter for Windows' };
      if (command === 'bluetoothctl') return { stdout: '' };
      throw new Error('Unexpected command');
    },
    readFile: async () => '',
    hardware: { ...emptyHardware, dongles: async () => ({ present: true, driver: 'xpadneo', pairingSupported: false, interfaces: [] }) }
  });
  const result = await pairing.start('dongle');
  assert.equal(result.state, 'error');
  assert.equal(result.code, 'DRIVER_MISSING');
  assert.match(result.message, /xone/);
  assert.deepEqual(commands, []);
});

test('transport validation allow-lists only supported UI transports', () => {
  assert.equal(validateTransport('dongle'), 'dongle');
  assert.throws(() => validateTransport('bluetooth; shutdown'), /Unsupported controller transport/);
});

for (const [code, override] of [
  ['BLUETOOTH_UNAVAILABLE', async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }],
  ['BLUETOOTH_SOFT_BLOCKED', async (command, args) => command === 'rfkill' ? { stdout: 'Soft blocked: yes\nHard blocked: no' } : healthy(command, args)],
  ['BLUETOOTH_HARD_BLOCKED', async (command, args) => command === 'rfkill' ? { stdout: 'Soft blocked: yes\nHard blocked: yes' } : healthy(command, args)],
  ['ADAPTER_NOT_FOUND', async (command, args) => args[0] === 'list' ? { stdout: '' } : healthy(command, args)],
  ['ADAPTER_POWERED_OFF', async (command, args) => args[0] === 'show' ? { stdout: 'Powered: no' } : healthy(command, args)]
]) test(`Bluetooth preflight reports ${code} without spawning a scan`, async () => {
  const commands = [];
  const pairing = new ControllerPairing({ platform: 'linux', run: async (command, args, options) => {
    assert.equal(options.shell, false); assert.equal(options.env.LC_ALL, 'C'); assert.ok(options.timeout > 0); assert.ok(options.maxBuffer > 0);
    commands.push([command, args]); return override(command, args);
  }, spawn: () => { throw new Error('Scan must not start'); } });
  const result = await pairing.start('bluetooth');
  assert.equal(result.code, code); assert.equal(pairing.scan, null);
  if (code !== 'BLUETOOTH_UNAVAILABLE') assert.deepEqual(commands[0], ['bluetoothctl', ['list']]);
  if (code.includes('BLOCKED')) assert.equal(commands.length, 2);
});

test('AlreadyExists continues through trust and connect even when pair exits nonzero', async () => {
  const calls = [];
  const pairing = new ControllerPairing({ platform: 'linux', run: async (command, args, options) => {
    calls.push([args[0], options.timeout]);
    if (args[0] === 'pair') throw Object.assign(new Error('exit 1'), { stderr: 'org.bluez.Error.AlreadyExists' });
    return healthy(command, args);
  } });
  assert.equal((await pairing.pair(MAC)).success, true);
  assert.deepEqual(calls.slice(0, 3), [['pair', 60000], ['trust', 15000], ['connect', 30000]]);
});

for (const [verb, code] of [['pair', 'PAIR_FAILED'], ['trust', 'TRUST_FAILED'], ['connect', 'CONNECT_FAILED']]) {
  test(`${verb} failure has a distinct code and never emits success`, async () => {
    const events = [];
    const pairing = new ControllerPairing({ platform: 'linux', run: async (command, args) => args[0] === verb ? { stdout: 'Failed' } : healthy(command, args), emitEvent: (name) => events.push(name) });
    assert.equal((await pairing.pair(MAC)).code, code);
    assert.equal(events.includes('pairing-success'), false);
  });
}

test('scan timeout and unexpected process exit both stop discovery and kill the child', async () => {
  for (const earlyExit of [false, true]) {
    const child = fakeChild(); const commands = []; const events = [];
    const pairing = new ControllerPairing({ platform: 'linux', spawn: () => child, scanTimeoutMs: 15,
      run: async (command, args) => { commands.push(args); return healthy(command, args); }, emitEvent: (name, payload) => events.push([name, payload]) });
    assert.equal((await pairing.start('bluetooth')).state, 'scanning');
    if (earlyExit) child.emit('close', 1);
    await delay(40);
    assert.equal(pairing.scan, null); assert.equal(child.killed, true);
    assert.ok(commands.some((args) => args.join(' ') === 'scan off'));
    assert.equal(events.at(-1)[1].code, earlyExit ? 'BLUETOOTH_UNAVAILABLE' : 'SCAN_TIMEOUT');
    await pairing.dispose();
  }
});

test('scan ignores paired devices, deduplicates MACs and sanitizes radio names', async () => {
  const child = fakeChild(); const events = [];
  const paired = '11:22:33:44:55:66';
  const pairing = new ControllerPairing({ platform: 'linux', spawn: () => child,
    run: async (command, args) => args[0] === 'info' ? { stdout: `Paired: ${args[1] === paired ? 'yes' : 'no'}` } : healthy(command, args),
    emitEvent: (name, value) => events.push([name, value]) });
  await pairing.start('bluetooth');
  child.stdout.write(`\x1b[0m[NEW] Device ${MAC} Xbox Elite\u202e Controller\nDevice ${MAC} Xbox Elite\nDevice ${paired} Xbox Adaptive\nDevice 12:34:56:78:90:AB DualSense\n`);
  await tick();
  const found = events.filter(([name]) => name === 'device-found');
  assert.equal(found.length, 1); assert.equal(found[0][1].id, MAC); assert.doesNotMatch(found[0][1].name, /\u202e/);
  assert.equal((await pairing.start('bluetooth')).state, 'error');
  await pairing.cancel();
});

test('explicit Bluetooth recovery never escalates and maps denied access', async () => {
  const calls = [];
  const pairing = new ControllerPairing({ platform: 'linux', run: async (command, args) => {
    calls.push([command, args]);
    if (args[0] === 'list') return { stdout: `Controller ${MAC} Radio` };
    if (args[0] === 'show') return { stdout: 'Powered: yes' };
    if (command === 'rfkill') return { stdout: 'Soft blocked: no\nHard blocked: no' };
    return { stdout: 'Changing power on succeeded' };
  } });
  assert.equal((await pairing.unblockBluetooth()).success, true);
  assert.deepEqual(calls, [
    ['rfkill', ['unblock', 'bluetooth']],
    ['bluetoothctl', ['power', 'on']],
    ['bluetoothctl', ['list']],
    ['rfkill', ['list', 'bluetooth']],
    ['bluetoothctl', ['show']]
  ]);
  pairing.run = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  assert.equal((await pairing.unblockBluetooth()).code, 'PERMISSION_DENIED');
});

async function sysfsFixture(t, deny = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-sysfs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = {
    'bus/usb/devices/1-2/idVendor': '045e', 'bus/usb/devices/1-2/idProduct': '02e6',
    'devices/usb1/1-2/idVendor': '045e', 'devices/usb1/1-2/idProduct': '02e6',
    'devices/usb1/1-2/interface/pairing': '0', 'module/xone_dongle/refcnt': '1',
    'devices/usb1/1-2/interface/gip0/gip0.0/input/input1/name': 'Xbox Wireless Controller',
    'class/power_supply/pad/serial_number': MAC, 'class/power_supply/pad/capacity': '64', 'class/power_supply/pad/status': 'Charging'
  };
  for (const [relative, text] of Object.entries(files)) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
  const directory = path.join(root, 'devices/usb1/1-2/interface');
  const driver = path.join(root, 'bus/usb/drivers/xone-dongle');
  const hardware = new LinuxControllerHardware({ sysRoot: root, fs: { ...fs,
    readdir: (file) => file === driver ? Promise.resolve(['1-2:1.0', 'bind']) : fs.readdir(file),
    realpath: (file) => file === path.join(driver, '1-2:1.0') ? Promise.resolve(directory) : fs.realpath(file),
    writeFile: (file, value) => deny ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })) : fs.writeFile(file, value)
  } });
  return { root, directory, hardware };
}

const inputFor = (sysfs, address = '') => `I: Bus=0003 Vendor=045e Product=0b13 Version=0001\nN: Name="Xbox Wireless Controller"\nS: Sysfs=${sysfs}\n${address ? `U: Uniq=${address}\n` : ''}H: Handlers=event1 js0`;

test('sysfs identifies xone, streams no discoverable dongle devices and verifies the receiver ancestry', async (t) => {
  const fixture = await sysfsFixture(t); let input = ''; const events = [];
  const pairing = new ControllerPairing({ platform: 'linux', hardware: fixture.hardware, readFile: async () => input, emitEvent: (name, value) => events.push([name, value]), pollIntervalMs: 10000 });
  t.after(() => pairing.dispose());
  assert.deepEqual(await pairing.getDongleStatus(), { present: true, driver: 'xone', pairingSupported: true });
  const started = await pairing.startDonglePairing(); assert.equal(started.state, 'scanning'); assert.deepEqual(started.devices, []);
  assert.equal((await fs.readFile(path.join(fixture.directory, 'pairing'), 'utf8')).trim(), '1');
  input = inputFor('/devices/usb1/1-2/interface/gip0/gip0.0/input/input1');
  clearTimeout(pairing.scan.poll); await pairing.pollSession(pairing.scan);
  assert.equal(pairing.scan, null);
  assert.equal(events.find(([name]) => name === 'pairing-success')[1].transport, 'dongle');
  assert.equal((await fs.readFile(path.join(fixture.directory, 'pairing'), 'utf8')).trim(), '0');
});

test('sysfs permission denial returns PERMISSION_DENIED without claiming pairing success', async (t) => {
  const { hardware } = await sysfsFixture(t, true);
  const pairing = new ControllerPairing({ platform: 'linux', hardware, readFile: async () => '' });
  assert.equal((await pairing.startDonglePairing()).code, 'PERMISSION_DENIED'); assert.equal(pairing.scan, null);
});

test('cancel and timeout disable dongle pairing mode', async (t) => {
  const { hardware, directory } = await sysfsFixture(t);
  const pairing = new ControllerPairing({ platform: 'linux', hardware, readFile: async () => '', scanTimeoutMs: 40 });
  await pairing.startDonglePairing(); await pairing.cancel();
  assert.equal((await fs.readFile(path.join(directory, 'pairing'), 'utf8')).trim(), '0');
  await pairing.startDonglePairing(); await delay(70);
  assert.equal(pairing.scan, null); assert.equal((await fs.readFile(path.join(directory, 'pairing'), 'utf8')).trim(), '0');
});

test('battery changes emit once and polling stops when disconnected or hidden', async () => {
  let battery = 40; let connected = true; let reads = 0; const events = [];
  const pairing = new ControllerPairing({ platform: 'win32', batteryIntervalMs: 12,
    run: async () => { reads++; return { stdout: JSON.stringify(connected ? [{ Name: 'Xbox Wireless Controller', InstanceId: 'BTHENUM\\PAD', Status: 'OK', Battery: battery, Charging: true }] : []) }; },
    emitEvent: (name, value) => events.push([name, value]) });
  pairing.setVisible(true); await pairing.getStatus(); battery = 39; await pairing.getStatus(); await pairing.getStatus();
  assert.equal(events.filter(([name]) => name === 'battery-update').length, 1);
  assert.deepEqual(events.find(([name]) => name === 'battery-update')[1], { id: pairing.controllers[0].id, battery: 39, charging: true });
  connected = false; await delay(35); assert.equal(pairing.batteryTimer, null);
  const stoppedReads = reads; await delay(25); assert.equal(reads, stoppedReads);
  connected = true; await pairing.getStatus(); assert.notEqual(pairing.batteryTimer, null);
  pairing.setVisible(false); assert.equal(pairing.batteryTimer, null); await pairing.dispose();
});

test('Linux batteries use the controller address and BlueZ percentage when sysfs is absent', async (t) => {
  const { hardware, root } = await sysfsFixture(t);
  const pairing = new ControllerPairing({ platform: 'linux', hardware, readFile: async () => inputFor('/devices/usb1/1-2/interface/gip0/gip0.0/input/input1', MAC),
    run: async () => ({ stdout: 'Battery Percentage: 0x32 (50)' }) });
  const first = await pairing.getStatus(); assert.equal(first.controllers[0].battery, 64); assert.equal(first.controllers[0].charging, true);
  await fs.rm(path.join(root, 'class/power_supply/pad'), { recursive: true });
  const second = await pairing.getStatus(); assert.equal(second.controllers[0].battery, 50); assert.equal(second.controllers[0].charging, false);
});

test('Windows maps absent and disabled radios and detects only newly connected controllers', async () => {
  for (const [radios, expected] of [['[]', 'ADAPTER_NOT_FOUND'], ['[{"Disabled":true}]', 'ADAPTER_POWERED_OFF']]) {
    const pairing = new ControllerPairing({ platform: 'win32', run: async () => ({ stdout: radios }) });
    assert.equal((await pairing.start('bluetooth')).code, expected);
  }
  let added = false; let refocused = false; const events = [];
  const pairing = new ControllerPairing({ platform: 'win32', openSettings: async () => {}, refocus: () => { refocused = true; },
    run: async (_command, args) => ({ stdout: args.at(-1) === WINDOWS_RADIO_SCRIPT ? '[{"Disabled":false}]' : JSON.stringify(added ? [{ Name: 'Xbox', InstanceId: 'BTHENUM\\NEW', Status: 'OK' }] : []) }),
    emitEvent: (name) => events.push(name) });
  assert.equal((await pairing.start('bluetooth')).state, 'scanning'); added = true;
  await pairing.pollWindowsScan(pairing.scan); assert.ok(events.includes('pairing-success')); assert.equal(refocused, true); assert.equal(pairing.scan, null);
});

test('cancel during pair aborts the OS command and prevents trust/connect', async () => {
  let entered; const ready = new Promise((resolve) => { entered = resolve; }); const calls = [];
  const pairing = new ControllerPairing({ platform: 'linux', run: async (_command, args, options) => {
    calls.push(args[0]); entered();
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })), { once: true }));
  } });
  const result = pairing.pair(MAC); await ready; await pairing.cancel();
  assert.equal((await result).code, 'CANCELLED'); assert.deepEqual(calls, ['pair']); assert.equal(pairing.scan, null);
});

test('cancel while enabling a dongle waits for the write before disabling it', async () => {
  let release; let entered;
  const ready = new Promise((resolve) => { entered = resolve; }); const writes = [];
  const hardware = { ...emptyHardware, dongles: async () => ({ present: true, driver: 'xone', pairingSupported: true, interfaces: [{ directory: '/sys/devices/dongle' }] }),
    setPairing: async (_entry, enabled) => { if (enabled) { entered(); await new Promise((resolve) => { release = resolve; }); } writes.push(enabled); } };
  const pairing = new ControllerPairing({ platform: 'linux', hardware, readFile: async () => '' });
  const starting = pairing.startDonglePairing(); await ready;
  const cancelling = pairing.cancel(); release(); await cancelling;
  assert.equal((await starting).code, 'CANCELLED'); assert.deepEqual(writes, [true, false]); assert.equal(pairing.scan, null);
});

test('USB waits for a genuinely new controller instead of returning an existing device as discovery', async () => {
  const output = JSON.stringify([{ Name: 'Xbox', InstanceId: 'USB\\EXISTING', Status: 'OK' }]);
  const pairing = new ControllerPairing({ platform: 'win32', run: async () => ({ stdout: output }) });
  const result = await pairing.start('usb'); assert.equal(result.state, 'scanning'); assert.deepEqual(result.devices, []);
  await pairing.pollWindowsScan(pairing.scan); assert.notEqual(pairing.scan, null); await pairing.dispose();
});

test('disconnecting a different dongle or wired controller cannot complete receiver pairing', async (t) => {
  const { hardware } = await sysfsFixture(t); let input = '';
  const pairing = new ControllerPairing({ platform: 'linux', hardware, readFile: async () => input }); t.after(() => pairing.dispose());
  await pairing.startDonglePairing(); input = inputFor('/devices/unrelated/input/input1');
  clearTimeout(pairing.scan.poll); await pairing.pollSession(pairing.scan); assert.notEqual(pairing.scan, null);
});

test('battery script treats Fully Charged (3) as AC power', () => {
  const script = require('node:fs').readFileSync(require('node:path').join(__dirname, '../scripts/get-battery.ps1'), 'utf8');
  assert.match(script, /@\(2,\s*3,/);
});

test('MenuIndicators clamps interval and close() detaches the worker', async () => {
  const { MenuIndicators } = require('../backend/menu-indicators');
  const indicators = new MenuIndicators();
  indicators.start(0);
  assert.ok(indicators.worker);
  const changes = [];
  indicators.on('changed', (value) => changes.push(value));
  await indicators.close();
  assert.equal(indicators.worker, null);
  indicators.publish();
  assert.equal(changes.length, 0);
});
