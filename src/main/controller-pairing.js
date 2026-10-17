'use strict';

const { createHash } = require('node:crypto');
const { ControllerSession } = require('./controller-session');
const { cleanText, batteryPercent } = require('./controller-hardware');
const { WINDOWS_ENUM_SCRIPT } = require('./controller-windows');
const ALLOWED_TRANSPORTS = new Set(['bluetooth', 'dongle', 'usb']);
const CONTROLLER_NAME = /xbox|gamepad|game\s*controller|joystick|dualsense|dualshock|wireless controller|8bitdo|pro controller|stadia/i;
const BLUETOOTH_ID = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

function validateTransport(transport) {
  if (!ALLOWED_TRANSPORTS.has(transport)) throw new Error('Unsupported controller transport');
  return transport;
}

function controllerIdFromWindows(instanceId) {
  return `win:${createHash('sha256').update(instanceId).digest('hex')}`;
}

function parseBluetoothDevices(output) {
  const devices = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:\[(?:NEW|CHG)\]\s+)?Device\s+((?:[0-9a-f]{2}:){5}[0-9a-f]{2})\s+(?:(?:Name|Alias):\s*)?(.+?)\s*$/i);
    if (!match || !/\bxbox\b/i.test(match[2]) || !BLUETOOTH_ID.test(match[1])) continue;
    const id = match[1].toUpperCase();
    devices.set(id, { id, name: cleanText(match[2]), transport: 'bluetooth', battery: null, charging: false, connected: false });
  }
  return [...devices.values()];
}

function parseInputDevices(output) {
  const devices = [];
  for (const block of String(output || '').split(/\r?\n\r?\n/)) {
    const name = block.match(/^N:\s+Name="(.+)"\s*$/m)?.[1];
    if (!name || !CONTROLLER_NAME.test(name)) continue;
    const ids = block.match(/^I:\s+Bus=([0-9a-f]+)\s+Vendor=([0-9a-f]+)\s+Product=([0-9a-f]+)/mi);
    const bus = ids?.[1]?.toLowerCase();
    const vendor = ids?.[2]?.toLowerCase();
    const product = ids?.[3]?.toLowerCase();
    const unique = block.match(/^U:\s+Uniq=(.+)$/m)?.[1]?.trim();
    const sysfs = block.match(/^S:\s+Sysfs=(.+)$/m)?.[1]?.trim() || name;
    const handlers = block.match(/^H:\s+Handlers=(.+)$/m)?.[1] || '';
    const bluetoothAddress = unique?.match(BLUETOOTH_ID)?.[0];
    const id = bluetoothAddress
      ? bluetoothAddress.toUpperCase()
      : `linux:${createHash('sha256').update(`${sysfs}\n${name}\n${handlers}`).digest('hex')}`;
    const transport = bluetoothAddress || bus === '0005'
      ? 'bluetooth'
      : bus === '0003' && vendor === '045e' && ['02e6', '02fe'].includes(product)
        ? 'dongle'
        : 'usb';
    const device = { id, name: cleanText(name), transport, battery: null, charging: false, connected: true };
    Object.defineProperty(device, 'sysfs', { value: sysfs });
    devices.push(device);
  }
  return devices;
}

function parseWindowsDevices(output) {
  if (!String(output || '').trim()) return [];
  const value = JSON.parse(output);
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter((entry) => entry && typeof entry.Name === 'string' && typeof entry.InstanceId === 'string')
    .map((entry) => {
      const name = cleanText(entry.Name);
      const instanceId = entry.InstanceId;
      const lower = instanceId.toLowerCase();
      const transport = /bthenum|bthledevice/.test(lower)
        ? 'bluetooth'
        : (/wireless adapter|wireless receiver|wireless dongle/i.test(name) || /vid_045e&pid_(?:02e6|02fe)/i.test(instanceId))
          ? 'dongle'
          : 'usb';
      return { id: controllerIdFromWindows(instanceId), name, transport: ALLOWED_TRANSPORTS.has(entry.Transport) ? entry.Transport : transport, battery: batteryPercent(entry.Battery), charging: entry.Charging === true, connected: String(entry.Status).toLowerCase() === 'ok' };
    });
}

class ControllerPairing extends ControllerSession {
  constructor(options = {}) {
    super({ ...options, parsers: { parseBluetoothDevices, parseInputDevices, parseWindowsDevices, WINDOWS_ENUM_SCRIPT } });
  }
}
module.exports = {
  ControllerPairing,
  parseBluetoothDevices,
  parseInputDevices,
  parseWindowsDevices,
  validateTransport,
  WINDOWS_ENUM_SCRIPT
};
