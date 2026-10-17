'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateConfigPresetIcons } = require('../src/main/preset-migration');

const LEGACY = 'file:///D:/Github%20Repos/Home-Media-Launcher/src/renderer/icons/presets/netflix.svg';

test('legacy absolute preset icon is rewritten to a token and saved once', async () => {
  const config = { settings: { a: 1 }, websites: [{ id: 'preset:netflix', name: 'Netflix', url: 'https://netflix.com', icon: LEGACY, category: 'x' }, { id: 'c', name: 'C', url: 'https://c.example', icon: 'https://c.example/i.png' }] };
  const saved = [];
  const next = await migrateConfigPresetIcons(config, async (value) => { saved.push(value); });
  assert.equal(next.websites[0].icon, 'preset:netflix');
  assert.deepEqual(next.websites[1], config.websites[1]);
  assert.equal(next.settings, config.settings);
  assert.equal(saved.length, 1);
  const again = await migrateConfigPresetIcons(next, async () => { throw new Error('must not save'); });
  assert.equal(again, next, 'idempotent');
});

test('no save when nothing is legacy, and missing websites is tolerated', async () => {
  const fail = async () => { throw new Error('must not save'); };
  const clean = { websites: [{ id: 'a', icon: 'preset:netflix' }] };
  assert.equal(await migrateConfigPresetIcons(clean, fail), clean);
  const none = {};
  assert.equal(await migrateConfigPresetIcons(none, fail), none);
});
