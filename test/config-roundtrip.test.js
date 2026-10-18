'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfig } = require('../src/main/config');

const VALID_CATEGORIES = [
  { id: 'theatre', label: 'Home Theatre', builtin: 'theatre' },
  { id: 'gaming', label: 'Gaming', builtin: 'gaming' }
];

const VALID_SETTINGS = {
  categories: VALID_CATEGORIES,
  homeHeader: { layout: 'split', showSeconds: true, oledProtection: false, fadeIn: true },
  showTileLabels: true,
  mediaWidget: false,
  soloist: { enabled: true, deviceName: 'Living Room', binaryPath: 'C:\\Apps\\Soloist\\soloist.exe' },
  hiddenAppIds: ['app.hidden'],
  performance: 'quality'
};

const VALID_WEBSITES = [{ name: 'YouTube', url: 'https://www.youtube.com', category: 'theatre' }];

function validConfig() {
  return { settings: { ...VALID_SETTINGS }, rows: [], websites: [...VALID_WEBSITES] };
}

test('accepts a config with every Settings dialog key', () => {
  assert.doesNotThrow(() => validateConfig(validConfig()));
});
