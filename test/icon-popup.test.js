'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Model = require('../src/renderer/icon-popup-model');
const { validateConfig } = require('../src/main/config');
const presets = require('../backend/web-presets');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('readCategories falls back to Home Theatre and Gaming', () => {
  const defaults = [{ id: 'theatre', label: 'Home Theatre' }, { id: 'gaming', label: 'Gaming' }];
  for (const input of [undefined, null, {}, { categories: 'x' }, { categories: [] }, { categories: [null, { id: 3 }, { id: ' ' }] }]) {
    assert.deepEqual(Model.readCategories(input), defaults);
  }
});

test('readCategories keeps valid entries, drops duplicates and labels from ids', () => {
  const result = Model.readCategories({ categories: [{ id: 'theatre', label: 'Cinema' }, { id: 'theatre', label: 'Again' }, { id: 'kids' }] });
  assert.deepEqual(result, [{ id: 'theatre', label: 'Cinema' }, { id: 'kids', label: 'kids' }]);
});

test('categoryChoices defaults to theatre and keeps unknown stored ids selectable', () => {
  const categories = Model.readCategories(undefined);
  assert.equal(Model.categoryChoices(categories, undefined).selected, 'theatre');
  assert.equal(Model.categoryChoices(categories, 'gaming').selected, 'gaming');
  const orphan = Model.categoryChoices(categories, 'removed');
  assert.equal(orphan.selected, 'removed');
  assert.deepEqual(orphan.options.map((option) => option.id), ['theatre', 'gaming', 'removed']);
  assert.equal(categories.length, 2);
});

test('normaliseCandidates accepts arrays, results objects and strings, caps and dedupes', () => {
  assert.deepEqual(Model.normaliseCandidates(null), []);
  const one = Model.normaliseCandidates({ results: ['https://a/x.png', { url: 'https://a/x.png' }, { url: 'https://b/y.png', thumb: 'https://b/t.png', width: 512, height: 512, gameName: 'Game' }, { url: 5 }] });
  assert.deepEqual(one, [
    { url: 'https://a/x.png', thumb: 'https://a/x.png', label: 'Artwork' },
    { url: 'https://b/y.png', thumb: 'https://b/t.png', label: 'Game · 512×512' }
  ]);
  const many = Model.normaliseCandidates(Array.from({ length: 40 }, (_, index) => `https://a/${index}.png`));
  assert.equal(many.length, Model.MAX_CANDIDATES);
});

test('artKindFor and initialOf', () => {
  assert.equal(Model.artKindFor('game'), 'poster');
  assert.equal(Model.artKindFor('website'), 'icon');
  assert.equal(Model.initialOf('  netflix'), 'N');
  assert.equal(Model.initialOf(''), '?');
});

test('config validates the website category id additively', () => {
  const site = { name: 'A', url: 'https://example.com' };
  assert.doesNotThrow(() => validateConfig({ rows: [], websites: [site, { ...site, category: 'theatre' }, { ...site, category: 'custom-1' }] }));
  for (const category of ['', '   ', 5, null, 'x'.repeat(65)]) {
    assert.throws(() => validateConfig({ rows: [], websites: [{ ...site, category }] }), /category must be a category id/);
  }
});

test('preset websites land in Home Theatre', () => {
  const sites = presets.addPresetWebsites([], ['netflix', 'spotify', 'twitch']);
  assert.deepEqual(sites.map((site) => site.category), ['theatre', 'theatre', 'theatre']);
  validateConfig({ rows: [], websites: sites });
});

test('markup loads the popup scripts before settings.js and wires the popup into the dialog routing', () => {
  const html = read('src/renderer/index.html');
  assert.ok(html.indexOf('icon-popup-model.js') < html.indexOf('icon-popup.js'));
  assert.ok(html.indexOf('icon-popup.js') < html.indexOf('src="settings.js"'));
  assert.match(html, /settings-apps\.css/);
  const settings = read('src/renderer/settings.js');
  assert.match(settings, /window\.IconPopup\.dismiss\(\)/);
  assert.match(settings, /window\.IconPopup\.controls\(\)/);
  assert.match(settings, /category: card\.dataset\.category/);
});
