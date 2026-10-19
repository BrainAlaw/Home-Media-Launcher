'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAP_PATH = path.join(__dirname, '..', '..', 'backend', 'remote-keymap.json');
const ACTIONS = new Set(['up', 'down', 'left', 'right', 'confirm', 'back', 'close', 'home']);
const MAX_BUTTON_INDEX = 31;

function validateRemoteKeymap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new TypeError('Remote keymap must be an object');
  for (const key of ['buttons', 'keys', 'longKeys', 'axisDeadzone', 'longPressMs', 'exitButtons']) {
    if (!Object.hasOwn(map, key)) throw new TypeError(`Remote keymap is missing ${key}`);
  }
  for (const [index, action] of Object.entries(map.buttons)) {
    if (!/^(0|[1-9]\d*)$/.test(index) || Number(index) > MAX_BUTTON_INDEX) throw new TypeError(`Invalid gamepad button index: ${index}`);
    if (!ACTIONS.has(action)) throw new TypeError(`Invalid gamepad action: ${action}`);
  }
  for (const [key, action] of Object.entries(map.keys)) {
    if (!key.trim()) throw new TypeError('Remote key names must not be empty');
    if (!ACTIONS.has(action)) throw new TypeError(`Invalid remote key action: ${action}`);
  }
  for (const [key, action] of Object.entries(map.longKeys)) {
    if (!key.trim()) throw new TypeError('Long-press key names must not be empty');
    if (!ACTIONS.has(action)) throw new TypeError(`Invalid long-press key action: ${action}`);
  }
  if (!Number.isFinite(map.axisDeadzone) || map.axisDeadzone <= 0 || map.axisDeadzone > 1) throw new TypeError('axisDeadzone must be greater than 0 and at most 1');
  if (!Number.isInteger(map.longPressMs) || map.longPressMs < 100 || map.longPressMs > 5000) throw new TypeError('longPressMs must be an integer from 100 to 5000');
  if (!Array.isArray(map.exitButtons) || map.exitButtons.some((index) => !Number.isInteger(index) || index < 0 || index > MAX_BUTTON_INDEX)) {
    throw new TypeError(`exitButtons must contain button indexes from 0 to ${MAX_BUTTON_INDEX}`);
  }
  if (map.exitButtons.some((index) => map.buttons[String(index)] !== 'close')) throw new TypeError('Each exit button must map to close');
  return map;
}

function loadRemoteKeymap() {
  return validateRemoteKeymap(JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')));
}

function encodeRemoteKeymap(map) {
  return Buffer.from(JSON.stringify(validateRemoteKeymap(map)), 'utf8').toString('base64');
}

function decodeRemoteKeymapArgument(argument) {
  if (typeof argument !== 'string' || !argument.startsWith('--hml-keymap=')) return null;
  try {
    const encoded = argument.slice('--hml-keymap='.length);
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    return validateRemoteKeymap(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
  } catch {
    return null;
  }
}

function remoteKeymapArgument() {
  return `--hml-keymap=${encodeRemoteKeymap(loadRemoteKeymap())}`;
}

module.exports = { ACTIONS, validateRemoteKeymap, loadRemoteKeymap, encodeRemoteKeymap, decodeRemoteKeymapArgument, remoteKeymapArgument };
