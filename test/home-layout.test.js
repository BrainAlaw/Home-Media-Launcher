'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TileModel = require('../src/renderer/tile-model');
const HomeHeader = require('../src/renderer/home-header');
const { validateConfig } = require('../src/main/config');

const local = (id, extra = {}) => ({ id, name: id, provider: 'local', command: 'app', ...extra });
const remote = (id, extra = {}) => ({ id, name: id, provider: 'remote', remote: true, ...extra });
const site = (id, extra = {}) => ({ id, name: id, type: 'website', url: 'https://example.com', ...extra });

test('default categories keep stable theatre and gaming row ids in order', () => {
  const layout = TileModel.buildLayout([remote('g1'), local('a1'), site('w1')], []);
  assert.deepEqual(layout.rows.map((row) => [row.id, row.title]), [['theatre', 'Home Theatre'], ['gaming', 'Gaming']]);
  assert.deepEqual(layout.rows[0].tiles.map((tile) => tile.id), ['a1', 'w1']);
});

test('empty gaming row is kept with its message only when asked', () => {
  const kept = TileModel.buildLayout([local('a1')], [], { showEmptyGaming: true, gamingEmptyMessage: 'No apps yet' });
  assert.equal(kept.rows[1].emptyMessage, 'No apps yet');
  assert.deepEqual(TileModel.buildLayout([local('a1')], []).rows.map((row) => row.id), ['theatre']);
});

test('custom categories render in category order and honour tile.category', () => {
  const categories = [
    { id: 'theatre', label: 'Home Theatre', builtin: 'theatre' },
    { id: 'music', label: 'Music' },
    { id: 'gaming', label: 'Gaming', builtin: 'gaming' }
  ];
  const tiles = [site('spotify', { category: 'music' }), site('yt'), remote('g1'), local('tool', { category: 'music' })];
  const layout = TileModel.buildLayout(tiles, [], { categories });
  assert.deepEqual(layout.rows.map((row) => row.id), ['theatre', 'music', 'gaming']);
  assert.deepEqual(layout.rows[1].tiles.map((tile) => tile.id), ['spotify', 'tool']);
});

test('unknown or deleted category ids fall back to the default for the tile type', () => {
  const categories = [{ id: 'theatre', label: 'Home Theatre', builtin: 'theatre' }, { id: 'gaming', label: 'Gaming', builtin: 'gaming' }];
  assert.equal(TileModel.sectionOf(site('w', { category: 'deleted' }), categories), 'theatre');
  assert.equal(TileModel.sectionOf(remote('g', { category: 'deleted' }), categories), 'gaming');
  assert.equal(TileModel.sectionOf(site('w', { category: 'video' })), 'theatre');
  assert.equal(TileModel.sectionOf(site('w', { category: 'game' })), 'gaming');
  assert.equal(TileModel.sectionOf(local('m', { command: 'C:\\Moonlight.exe' })), 'gaming');
});

test('defaults survive renamed builtins and a missing gaming category', () => {
  const renamed = [{ id: 'films', label: 'Films', builtin: 'theatre' }, { id: 'play', label: 'Play', builtin: 'gaming' }];
  assert.equal(TileModel.sectionOf(local('a'), renamed), 'films');
  assert.equal(TileModel.sectionOf(remote('g'), renamed), 'play');
  const single = [{ id: 'all', label: 'Everything' }];
  assert.equal(TileModel.sectionOf(remote('g'), single), 'all');
  const noGaming = TileModel.buildLayout([local('a')], [], { categories: single, showEmptyGaming: true });
  assert.deepEqual(noGaming.rows.map((row) => row.id), ['all']);
});

test('normaliseCategories drops malformed and duplicate entries, else returns defaults', () => {
  assert.deepEqual(TileModel.normaliseCategories(undefined).map((c) => c.id), ['theatre', 'gaming']);
  assert.deepEqual(TileModel.normaliseCategories([{ id: '' }, null, 7]).map((c) => c.id), ['theatre', 'gaming']);
  const cleaned = TileModel.normaliseCategories([{ id: 'a', label: ' A ' }, { id: 'a', label: 'dup' }, { id: 'b' }]);
  assert.deepEqual(cleaned, [{ id: 'a', label: 'A' }, { id: 'b', label: 'b' }]);
});

test('recents lead each category row', () => {
  const layout = TileModel.buildLayout([local('a'), local('b'), local('c')], ['c']);
  assert.deepEqual(layout.rows[0].tiles.map((tile) => tile.id), ['c', 'a', 'b']);
});

test('header settings default to split layout, no seconds, protection and fade on', () => {
  assert.deepEqual(HomeHeader.normaliseHeaderSettings(undefined), { layout: 'split', showSeconds: false, oledProtection: true, fadeIn: true });
  assert.equal(HomeHeader.normaliseHeaderSettings({ layout: 'centred', showSeconds: true, fadeIn: false }).layout, 'centred');
  assert.equal(HomeHeader.normaliseHeaderSettings({ layout: 'wide' }).layout, 'split');
  assert.equal(HomeHeader.normaliseHeaderSettings({ oledProtection: false }).oledProtection, false);
});

test('weather location has no built-in default and is trimmed', () => {
  assert.equal(HomeHeader.headerWithDefaults({ weatherLocation: '  ' }).weatherLocation, '');
  assert.equal(HomeHeader.headerWithDefaults(undefined).weatherLocation, '');
  assert.equal(HomeHeader.headerWithDefaults({ weatherLocation: ' Leeds,GB ' }).weatherLocation, 'Leeds,GB');
  assert.equal(HomeHeader.headerWithDefaults({ weatherLocation: 'Leeds,GB', showWeather: true }).weatherLocation, 'Leeds,GB');
});

test('clock and date formatting', () => {
  const date = new Date(2026, 9, 17, 7, 5, 9);
  assert.equal(HomeHeader.formatClock(date, false), '07:05');
  assert.equal(HomeHeader.formatClock(date, true), '07:05:09');
  assert.deepEqual(HomeHeader.formatDateParts(date), { weekday: 'Saturday', date: '17 October 2026' });
});

test('clock tick lands just after the next boundary', () => {
  const at = (seconds, ms) => new Date(2026, 0, 1, 10, 0, seconds, ms);
  assert.equal(HomeHeader.msUntilTick(at(30, 500), true), 520);
  assert.equal(HomeHeader.msUntilTick(at(30, 0), false), 30020);
});

test('pixel shift stays within +/-4 px, moves slowly and eventually changes', () => {
  const seen = new Set();
  let previous = HomeHeader.pixelShift(0);
  for (let t = 0; t <= 24 * 60 * 60 * 1000; t += 30000) {
    const shift = HomeHeader.pixelShift(t);
    assert.ok(Math.abs(shift.x) <= 4 && Math.abs(shift.y) <= 4);
    assert.ok(Number.isInteger(shift.x) && Number.isInteger(shift.y));
    assert.ok(Math.abs(shift.x - previous.x) <= 1 && Math.abs(shift.y - previous.y) <= 1, 'one pixel per 30 s step at most');
    seen.add(`${shift.x},${shift.y}`);
    previous = shift;
  }
  assert.ok(seen.size > 20);
});

test('homeHeader config validation', () => {
  assert.doesNotThrow(() => validateConfig({ rows: [], settings: { homeHeader: { layout: 'centred', showSeconds: true, oledProtection: false, fadeIn: true } } }));
  assert.doesNotThrow(() => validateConfig({ rows: [], settings: { homeHeader: {} } }));
  assert.throws(() => validateConfig({ rows: [], settings: { homeHeader: { layout: 'wide' } } }), /homeHeader.layout/);
  assert.throws(() => validateConfig({ rows: [], settings: { homeHeader: { fadeIn: 'yes' } } }), /homeHeader.fadeIn/);
  assert.throws(() => validateConfig({ rows: [], settings: { homeHeader: [] } }), /homeHeader must be an object/);
});
