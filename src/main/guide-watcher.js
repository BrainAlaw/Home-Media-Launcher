'use strict';

const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { createHoldDetector } = require('./hold-detector');

/**
 * Main-process Guide/Home button detection that works while another application owns the focus.
 * The HTML5 Gamepad API only reports to the focused window, so it cannot be used here.
 *  - Linux: evdev (/dev/input/eventN) of devices that also expose a joystick node (jsN), read with non-blocking reads.
 *  - Windows: undocumented XInputGetStateEx (ordinal 100) polled by a tiny hidden PowerShell process.
 * Events: `progress` (0..1), `cancel`, `complete` (Guide held for the full duration),
 * `combo` (Start+Select+L1+R1, Moonlight's own quit chord), `unavailable` (reason string).
 */

const EV_KEY = 1;
const BTN = { TL: 0x136, TR: 0x137, SELECT: 0x13a, START: 0x13b, MODE: 0x13c };
const XINPUT = { START: 0x0010, BACK: 0x0020, LB: 0x0100, RB: 0x0200, GUIDE: 0x0400 };

function evdevEventSize(arch = process.arch) { return arch === 'ia32' || arch === 'arm' ? 16 : 24; }

/** Decodes `struct input_event` records; only key events are returned. */
function parseEvdevEvents(buffer, length, eventSize = evdevEventSize()) {
  const events = [];
  const offset = eventSize - 8;
  for (let index = 0; index + eventSize <= length; index += eventSize) {
    if (buffer.readUInt16LE(index + offset) !== EV_KEY) continue;
    events.push({ code: buffer.readUInt16LE(index + offset + 2), value: buffer.readInt32LE(index + offset + 4) });
  }
  return events;
}

/** Extracts gamepad event nodes from /proc/bus/input/devices (entries that expose both jsN and eventN). */
function parseInputDevices(text) {
  const devices = [];
  for (const block of String(text).split(/\r?\n\s*\r?\n/)) {
    const name = /^N: Name="(.*)"$/m.exec(block)?.[1] ?? '';
    const handlers = (/^H: Handlers=(.*)$/m.exec(block)?.[1] ?? '').split(/\s+/).filter(Boolean);
    const event = handlers.find((handler) => /^event\d+$/.test(handler));
    if (event && handlers.some((handler) => /^js\d+$/.test(handler))) devices.push({ name, path: `/dev/input/${event}` });
  }
  return devices;
}

/** @param {number} mask XInput wButtons @returns {{ guide: boolean, combo: boolean }} */
function decodeXInputMask(mask) {
  const all = (bits) => (mask & bits) === bits;
  return { guide: all(XINPUT.GUIDE), combo: all(XINPUT.START | XINPUT.BACK | XINPUT.LB | XINPUT.RB) };
}

const XINPUT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -TypeDefinition @'",
  'using System.Runtime.InteropServices;',
  'public static class HmlXInput {',
  '  [StructLayout(LayoutKind.Sequential)] public struct Pad { public ushort Buttons; public byte LT; public byte RT; public short LX; public short LY; public short RX; public short RY; }',
  '  [StructLayout(LayoutKind.Sequential)] public struct State { public uint Packet; public Pad Gamepad; }',
  '  [DllImport("xinput1_4.dll", EntryPoint = "#100")] public static extern int GetStateEx(uint index, out State state);',
  '}',
  "'@",
  '$last = -1',
  'while ($true) {',
  '  $mask = 0',
  '  for ($i = 0; $i -lt 4; $i++) {',
  '    $state = New-Object HmlXInput+State',
  '    if ([HmlXInput]::GetStateEx($i, [ref]$state) -eq 0) { $mask = $mask -bor [int]$state.Gamepad.Buttons }',
  '  }',
  '  if ($mask -ne $last) { $last = $mask; [Console]::Out.WriteLine($mask); [Console]::Out.Flush() }',
  '  Start-Sleep -Milliseconds 30',
  '}'
].join('\r\n');

class GuideWatcher extends EventEmitter {
  constructor({
    platform = process.platform, fsApi = fs, spawnProcess = spawn, now = Date.now,
    holdMs = 700, tickMs = 40, rescanMs = 4000, eventSize = evdevEventSize()
  } = {}) {
    super();
    Object.assign(this, { platform, fsApi, spawnProcess, now, tickMs, rescanMs, eventSize });
    this.running = false;
    this.guide = false;
    this.combo = false;
    this.devices = new Map();
    this.timers = [];
    this.child = null;
    this.warned = false;
    this.detector = createHoldDetector({
      holdMs,
      onProgress: (progress) => this.emit('progress', progress),
      onComplete: () => this.emit('complete'),
      onCancel: () => this.emit('cancel')
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.warned = false;
    if (this.platform === 'linux') this.startLinux();
    else if (this.platform === 'win32') this.startWindows();
    else this.unavailable(`Guide button detection is not supported on ${this.platform}`);
    this.timers.push(setInterval(() => this.detector.update(this.guide, this.now()), this.tickMs));
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    for (const device of this.devices.values()) this.closeDevice(device);
    this.devices.clear();
    if (this.child) { try { this.child.kill(); } catch { /* already exited */ } this.child = null; }
    this.guide = false;
    this.combo = false;
    this.detector.reset();
  }

  unavailable(reason) {
    if (this.warned) return;
    this.warned = true;
    this.emit('unavailable', reason);
  }

  setCombo(active) {
    if (active && !this.combo) this.emit('combo');
    this.combo = active;
  }

  closeDevice(device) {
    try { this.fsApi.closeSync(device.fd); } catch { /* already closed */ }
  }

  /* ------------------------------------------------------------ Linux */

  startLinux() {
    this.scanLinux();
    this.timers.push(setInterval(() => this.scanLinux(), this.rescanMs));
    this.timers.push(setInterval(() => this.readLinux(), 30));
  }

  scanLinux() {
    let devices;
    try { devices = parseInputDevices(this.fsApi.readFileSync('/proc/bus/input/devices', 'utf8')); }
    catch (error) { this.unavailable(`Cannot list input devices: ${error.message}`); return; }
    const present = new Set(devices.map((device) => device.path));
    for (const [path, device] of this.devices) {
      if (present.has(path)) continue;
      this.closeDevice(device);
      this.devices.delete(path);
    }
    let denied = false;
    for (const { path, name } of devices) {
      if (this.devices.has(path)) continue;
      try {
        const fd = this.fsApi.openSync(path, this.fsApi.constants.O_RDONLY | this.fsApi.constants.O_NONBLOCK);
        this.devices.set(path, { fd, name, pressed: new Set(), buffer: Buffer.alloc(this.eventSize * 64) });
      } catch (error) { if (error.code === 'EACCES' || error.code === 'EPERM') denied = true; }
    }
    if (denied && this.devices.size === 0) this.unavailable('No permission to read /dev/input (add the user to the "input" group)');
  }

  readLinux() {
    let guide = false;
    let combo = false;
    for (const [path, device] of this.devices) {
      try {
        for (;;) {
          const length = this.fsApi.readSync(device.fd, device.buffer, 0, device.buffer.length, null);
          if (length <= 0) break;
          for (const { code, value } of parseEvdevEvents(device.buffer, length, this.eventSize)) {
            if (value === 0) device.pressed.delete(code);
            else if (value === 1) device.pressed.add(code);
          }
          if (length < device.buffer.length) break;
        }
      } catch (error) {
        if (error.code !== 'EAGAIN') { this.closeDevice(device); this.devices.delete(path); continue; }
      }
      guide ||= device.pressed.has(BTN.MODE);
      combo ||= [BTN.START, BTN.SELECT, BTN.TL, BTN.TR].every((code) => device.pressed.has(code));
    }
    this.guide = guide;
    this.setCombo(combo);
  }

  /* ------------------------------------------------------------ Windows */

  startWindows() {
    const encoded = Buffer.from(XINPUT_SCRIPT, 'utf16le').toString('base64');
    let child;
    try {
      child = this.spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
      });
    } catch (error) { this.unavailable(`Cannot start XInput helper: ${error.message}`); return; }
    this.child = child;
    let pending = '';
    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const mask = Number.parseInt(line.trim(), 10);
        if (!Number.isInteger(mask)) continue;
        const decoded = decodeXInputMask(mask);
        this.guide = decoded.guide;
        this.setCombo(decoded.combo);
      }
    });
    child.on('error', (error) => this.unavailable(`XInput helper failed: ${error.message}`));
    child.on('exit', () => { if (this.running && this.child === child) this.unavailable('XInput helper exited'); });
  }
}

module.exports = { GuideWatcher, parseEvdevEvents, parseInputDevices, decodeXInputMask, evdevEventSize, BTN, XINPUT };
