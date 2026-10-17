'use strict';

const fs = require('node:fs');

/**
 * ns `input` (agent F): detects connected remote-control style input devices.
 * Methods: `list()` -> RemoteDevice[] (empty where unsupported). Events: `devices` (RemoteDevice[]) on change.
 * Linux only (parses /proc/bus/input/devices); Windows/macOS return an empty list. Remote key handling itself
 * lives in the renderer (remote-keymap.js / remote-input.js).
 */

const REMOTE_NAME = /remote|fire\s?tv|chromecast|google\s?tv|android\s?tv|air\s?mouse|\brc\d*\b/i;
const FUNCTION_SUFFIX = /\s+(consumer control|system control|keyboard|mouse|touchpad|remote control)$/i;
const BUS = { '0003': 'usb', '0005': 'bluetooth', '0011': 'i8042', '0019': 'host' };
const POLL_MS = 10_000;

/**
 * @typedef {{ id: string, name: string, bus: 'usb'|'bluetooth'|'other', address?: string, handlers: string[] }} RemoteDevice
 */

/** @param {string} text contents of /proc/bus/input/devices @returns {RemoteDevice[]} */
function parseProcInputDevices(text) {
  const merged = new Map();
  for (const block of String(text).split(/\r?\n\s*\r?\n/)) {
    const name = /^N: Name="(.*)"$/m.exec(block)?.[1];
    if (!name || !REMOTE_NAME.test(name)) continue;
    const bus = BUS[/^I: Bus=([0-9a-f]{4})/im.exec(block)?.[1]?.toLowerCase()] || 'other';
    const uniq = /^U: Uniq=(\S+)/m.exec(block)?.[1];
    const address = uniq && /^[0-9a-f:]{11,}$/i.test(uniq) ? uniq.toLowerCase() : undefined;
    const handlers = (/^H: Handlers=(.*)$/m.exec(block)?.[1] || '').split(/\s+/).filter(Boolean);
    const baseName = name.replace(FUNCTION_SUFFIX, '');
    const id = `${bus}:${address || baseName}`;
    const existing = merged.get(id);
    if (existing) existing.handlers = [...new Set([...existing.handlers, ...handlers])];
    else merged.set(id, { id, name: baseName, bus: bus === 'usb' || bus === 'bluetooth' ? bus : 'other', ...(address ? { address } : {}), handlers });
  }
  return [...merged.values()];
}

/** @param {() => string} [read] */
function listRemoteDevices(read = () => fs.readFileSync('/proc/bus/input/devices', 'utf8')) {
  if (process.platform !== 'linux') return [];
  try { return parseProcInputDevices(read()); } catch { return []; }
}

let timer = null;
let lastSignature = '';

module.exports = {
  namespace: 'input',
  handlers: {
    list: () => listRemoteDevices()
  },
  start(ctx) {
    if (process.platform !== 'linux') return;
    const tick = () => {
      const devices = listRemoteDevices();
      const signature = JSON.stringify(devices);
      if (signature === lastSignature) return;
      lastSignature = signature;
      ctx.emit('devices', devices);
    };
    tick();
    timer = setInterval(tick, POLL_MS);
    timer.unref?.();
  },
  stop() { clearInterval(timer); timer = null; lastSignature = ''; },
  parseProcInputDevices,
  listRemoteDevices
};
