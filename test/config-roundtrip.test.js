'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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
  soloist: { enabled: true, deviceName: 'Living Room', binaryPath: path.resolve('Apps', 'Soloist', 'soloist') },
  hiddenAppIds: ['app.hidden'],
  performance: 'quality'
};

const VALID_WEBSITES = [{ name: 'YouTube', url: 'https://www.youtube.com', category: 'theatre' }];

function validConfig() {
  return { settings: { ...VALID_SETTINGS }, rows: [], websites: VALID_WEBSITES.map((website) => ({ ...website })) };
}

function configWithSetting(key, value) {
  const config = validConfig();
  config.settings[key] = value;
  return config;
}

test('accepts a config with every Settings dialog key', () => {
  assert.doesNotThrow(() => validateConfig(validConfig()));
});

test('validates categories', () => {
  assert.doesNotThrow(() => validateConfig(configWithSetting('categories', VALID_CATEGORIES)));
  assert.throws(
    () => validateConfig(configWithSetting('categories', [VALID_CATEGORIES[0]])),
    /gaming/
  );
  assert.throws(
    () => validateConfig(configWithSetting('categories', [
      ...VALID_CATEGORIES,
      { id: 'gaming', label: 'Duplicate Gaming' }
    ])),
    /categories/
  );
  assert.throws(
    () => validateConfig(configWithSetting('categories', [
      VALID_CATEGORIES[0],
      { id: 'Gaming!', label: 'Gaming' }
    ])),
    /categories/
  );
  assert.throws(
    () => validateConfig(configWithSetting('categories', [
      VALID_CATEGORIES[0],
      { ...VALID_CATEGORIES[1], label: 'G'.repeat(41) }
    ])),
    /label/
  );
});

test('validates homeHeader layout and flags', () => {
  const valid = { layout: 'centred', showSeconds: false, oledProtection: true, fadeIn: false };
  assert.doesNotThrow(() => validateConfig(configWithSetting('homeHeader', valid)));
  assert.throws(
    () => validateConfig(configWithSetting('homeHeader', { ...valid, layout: 'stacked' })),
    /homeHeader\.layout/
  );
  assert.throws(
    () => validateConfig(configWithSetting('homeHeader', { ...valid, showSeconds: 'yes' })),
    /homeHeader\.showSeconds/
  );
});

test('validates showTileLabels as a boolean', () => {
  assert.doesNotThrow(() => validateConfig(configWithSetting('showTileLabels', false)));
  assert.throws(() => validateConfig(configWithSetting('showTileLabels', 'yes')), /showTileLabels/);
});

test('validates mediaWidget as a boolean', () => {
  assert.doesNotThrow(() => validateConfig(configWithSetting('mediaWidget', true)));
  assert.throws(() => validateConfig(configWithSetting('mediaWidget', 1)), /mediaWidget/);
});

test('validates soloist settings', () => {
  const valid = { enabled: false, deviceName: 'Living Room', binaryPath: '' };
  assert.doesNotThrow(() => validateConfig(configWithSetting('soloist', valid)));
  assert.throws(
    () => validateConfig(configWithSetting('soloist', { ...valid, binaryPath: 'relative/soloist' })),
    /binaryPath/
  );
  assert.throws(
    () => validateConfig(configWithSetting('soloist', { ...valid, deviceName: '' })),
    /deviceName/
  );
});

test('validates hiddenAppIds as an array of strings', () => {
  assert.doesNotThrow(() => validateConfig(configWithSetting('hiddenAppIds', ['app.hidden'])));
  assert.throws(
    () => validateConfig(configWithSetting('hiddenAppIds', ['app.hidden', 7])),
    /array of strings/
  );
});

test('validates performance values', () => {
  assert.doesNotThrow(() => validateConfig(configWithSetting('performance', 'lite')));
  assert.throws(() => validateConfig(configWithSetting('performance', 'maximum')), /performance/);
});

test('validates website category', () => {
  assert.doesNotThrow(() => validateConfig(validConfig()));
  const config = validConfig();
  config.websites[0].category = '';
  assert.throws(() => validateConfig(config), /websites\[0\]\.category/);
});
