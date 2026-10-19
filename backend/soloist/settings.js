'use strict';

const path = require('node:path');

/** Name under which the Soloist device is registered with Spotify Connect (matched case-insensitively in GET /me/player/devices). */
const DEFAULT_DEVICE_NAME = 'Home Media Launcher';
const DEVICE_NAME_MAX = 64;
const BINARY_PATH_MAX = 512;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

const DEFAULT_SOLOIST_SETTINGS = Object.freeze({ enabled: false, deviceName: DEFAULT_DEVICE_NAME, binaryPath: '' });

/**
 * Validates `settings.soloist` from config.json. Throws with a message naming the offending key.
 * Every key is optional; the block itself is optional.
 * @param {unknown} value
 */
function validateSoloistSettings(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('settings.soloist must be an object');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('settings.soloist.enabled must be boolean');
  if (value.deviceName !== undefined) {
    if (typeof value.deviceName !== 'string' || !value.deviceName.trim() || value.deviceName.trim().length > DEVICE_NAME_MAX || CONTROL_CHARS.test(value.deviceName)) {
      throw new Error(`settings.soloist.deviceName must be a non-empty string of at most ${DEVICE_NAME_MAX} characters`);
    }
  }
  if (value.binaryPath !== undefined) {
    if (typeof value.binaryPath !== 'string' || value.binaryPath.length > BINARY_PATH_MAX || CONTROL_CHARS.test(value.binaryPath)) {
      throw new Error('settings.soloist.binaryPath must be a string');
    }
    if (value.binaryPath !== '' && !path.isAbsolute(value.binaryPath)) throw new Error('settings.soloist.binaryPath must be an absolute path');
  }
}

/**
 * Applies defaults to a (possibly partial or absent) `settings.soloist` block. Assumes `validateSoloistSettings` has passed.
 * @param {unknown} value
 * @returns {{ enabled: boolean, deviceName: string, binaryPath: string }}
 */
function normaliseSoloistSettings(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const deviceName = typeof input.deviceName === 'string' ? input.deviceName.trim() : '';
  return {
    enabled: input.enabled === true,
    deviceName: deviceName || DEFAULT_SOLOIST_SETTINGS.deviceName,
    binaryPath: typeof input.binaryPath === 'string' ? input.binaryPath : ''
  };
}

module.exports = {
  DEFAULT_DEVICE_NAME,
  DEVICE_NAME_MAX,
  BINARY_PATH_MAX,
  DEFAULT_SOLOIST_SETTINGS,
  validateSoloistSettings,
  normaliseSoloistSettings
};
