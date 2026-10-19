'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GROUPS, SETTINGS, INTERNAL_PATHS } = require('../backend/settings-descriptor');
const { validateConfig } = require('../src/main/config');

const configSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'config.js'), 'utf8');

/** Keys read directly from config.settings in the validator (config.settings?.X). */
function validatedSettingKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/config\.settings\??\.([A-Za-z_]\w*)/g)) keys.add(match[1]);
  return keys;
}

/**
 * Keys checked inside a loop over a literal list (`for (const key of [...]) { ... config.settings?.[key] ... }`).
 * The list is read from the source so a new key added to that loop is picked up automatically.
 */
function loopedSettingKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/for \(const key of \[([^\]]+)\]\) \{\s*\n?\s*if \(config\.settings\?\.\[key\]/g)) {
    for (const item of match[1].matchAll(/'([A-Za-z_]\w*)'/g)) keys.add(item[1]);
  }
  return keys;
}

const described = new Set(SETTINGS.map((entry) => entry.path));
const internal = new Set(INTERNAL_PATHS.map((entry) => entry.path));
const validated = new Set([...validatedSettingKeys(configSource), ...loopedSettingKeys(configSource)]);

test('every validated setting is described in the panel or listed as internal', () => {
  assert.ok(validated.size >= 10, `expected to find the validator's keys, found ${validated.size}`);
  const missing = [...validated].filter((key) => !described.has(key) && !internal.has(key));
  assert.deepEqual(missing, [], `add these to backend/settings-descriptor.js (or INTERNAL_PATHS with a reason): ${missing.join(', ')}`);
});

// Descriptions may describe settings the validator does not check (for example `title`, `header`, `theme`):
// those are real settings the renderer writes, so the direction that matters is validated -> described (above).

test('every internal path has a reason and no path is both described and internal', () => {
  for (const entry of INTERNAL_PATHS) assert.ok(entry.reason && entry.reason.length > 10, `${entry.path} needs a reason`);
  const both = [...described].filter((key) => internal.has(key));
  assert.deepEqual(both, []);
});

test('every entry has a known group, label and type', () => {
  const types = new Set(['boolean', 'text', 'number', 'enum', 'object']);
  for (const entry of SETTINGS) {
    assert.ok(GROUPS[entry.group], `${entry.path}: unknown group ${entry.group}`);
    assert.ok(entry.label && entry.label.length > 0, `${entry.path}: label`);
    assert.ok(types.has(entry.type), `${entry.path}: type ${entry.type}`);
    if (entry.type === 'enum') assert.ok(Array.isArray(entry.options) && entry.options.length > 0, `${entry.path}: enum needs options`);
  }
});

test('scalar defaults pass the validator', () => {
  const settings = {};
  for (const entry of SETTINGS) {
    if (entry.type === 'object' || entry.default === undefined) continue;
    settings[entry.path] = entry.default;
  }
  assert.doesNotThrow(() => validateConfig({ settings, rows: [] }));
});
