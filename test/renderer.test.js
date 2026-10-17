'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findNext } = require('../src/renderer/spatial-nav');
const { buildLayout, pushRecent, categorise, subtitle } = require('../src/renderer/tile-model');
const { assetUrl, isLoadableImage } = require('../src/renderer/asset-url');
const { GamepadInput } = require('../src/renderer/gamepad-input');

const box = (id, col, row, width = 100, height = 60) => ({
  id, left: col * 120, top: row * 100, right: col * 120 + width, bottom: row * 100 + height
});

test('spatial nav moves within a row and between rows', () => {
  const grid = [box('a', 0, 0), box('b', 1, 0), box('c', 2, 0), box('d', 0, 1), box('e', 1, 1)];
  assert.equal(findNext(grid[0], grid, 'right'), 'b');
  assert.equal(findNext(grid[1], grid, 'left'), 'a');
  assert.equal(findNext(grid[1], grid, 'down'), 'e');
  assert.equal(findNext(grid[4], grid, 'up'), 'b');
  assert.equal(findNext(grid[0], grid, 'left'), null);
  assert.equal(findNext(grid[0], grid, 'up'), null);
});

test('spatial nav down picks the adjacent row, not a farther aligned row', () => {
  const current = box('cur', 0, 0);
  const nearFarX = box('near', 8, 1);
  const farAligned = box('far', 0, 2);
  assert.equal(findNext(current, [current, nearFarX, farAligned], 'down'), 'near');
});

test('spatial nav left/right ignores other rows and falls back to dominant axis', () => {
  const current = box('cur', 1, 0);
  const otherRow = box('below', 2, 3);
  assert.equal(findNext(current, [current, otherRow], 'right'), null);
  const wide = { id: 'wide', left: 0, top: 0, right: 100, bottom: 40 };
  const diagonal = { id: 'diag', left: 400, top: 60, right: 500, bottom: 100 };
  assert.equal(findNext(wide, [wide, diagonal], 'right'), 'diag');
});

test('spatial nav lands on the closest column when changing rows', () => {
  const current = box('cur', 3, 0);
  const row = [0, 1, 2, 3, 4].map((col) => box(`r${col}`, col, 1));
  assert.equal(findNext(current, [current, ...row], 'down'), 'r3');
});

test('layout splits tiles into Home Theatre and Gaming with recents first', () => {
  const tiles = [
    { id: 'g1', name: 'Game', provider: 'remote' },
    { id: 'a1', name: 'App', provider: 'local', command: '/usr/bin/app' },
    { id: 'm1', name: 'Custom Moonlight', command: 'moonlight-qt' },
    { id: 'w1', name: 'Web', type: 'website', url: 'https://www.example.com/x' },
    { id: 'l1', name: 'Local game', provider: 'local', category: 'game' },
    { id: 'v1', name: 'Music', type: 'webapp', category: 'music' }
  ];
  const fresh = buildLayout(tiles, []);
  assert.deepEqual(fresh.rows.map((row) => [row.id, row.title]), [['theatre', 'Home Theatre'], ['gaming', 'Gaming']]);
  assert.deepEqual(fresh.rows[0].tiles.map((tile) => tile.id), ['a1', 'w1', 'v1']);
  assert.deepEqual(fresh.rows[1].tiles.map((tile) => tile.id), ['g1', 'm1', 'l1']);

  const withRecents = buildLayout(tiles, ['v1', 'gone', 'l1']);
  assert.deepEqual(withRecents.rows[0].tiles.map((tile) => tile.id), ['v1', 'a1', 'w1']);
  assert.deepEqual(withRecents.rows[1].tiles.map((tile) => tile.id), ['l1', 'g1', 'm1']);
  assert.deepEqual(buildLayout([], []).rows, []);
  assert.deepEqual(buildLayout([tiles[1]], [], { showEmptyGaming: true }).rows.map((row) => row.id), ['theatre', 'gaming']);
});

test('recents are deduplicated, ordered and capped', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(pushRecent(['a', 'b'], 'c', 2), ['c', 'a']);
});

test('tile categories and subtitles', () => {
  assert.equal(categorise({ id: 'x', name: 'x', command: 'C:\\Apps\\Moonlight.exe' }), 'game');
  assert.equal(subtitle({ id: 'w', name: 'w', type: 'website', url: 'https://www.example.com/a' }), 'example.com');
});

test('asset urls handle posix, windows, escaping and passthrough', () => {
  assert.equal(assetUrl('/home/u/a b#.png'), 'file:///home/u/a%20b%23.png');
  assert.equal(assetUrl('C:\\Users\\u\\i.png'), 'file:///C:/Users/u/i.png');
  assert.equal(assetUrl('https://x.test/i.png'), 'https://x.test/i.png');
  assert.equal(assetUrl(''), '');
  assert.equal(isLoadableImage('firefox'), false);
  assert.equal(isLoadableImage('/a/b'), true);
  assert.equal(isLoadableImage('data:image/png;base64,AA'), true);
});

function fakePad(overrides = {}) {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }));
  for (const index of overrides.pressed || []) buttons[index].pressed = true;
  return { index: 0, connected: true, buttons, axes: overrides.axes || [0, 0] };
}

function harness() {
  const actions = [];
  let pad = fakePad();
  const input = new GamepadInput({ onAction: (action) => actions.push(action), getGamepads: () => [pad], repeatDelay: 100, repeatInterval: 50 });
  return { actions, input, set: (next) => { pad = next; } };
}

test('gamepad emits edge-triggered actions and repeats directions only', () => {
  const { actions, input, set } = harness();
  input.poll(0);
  set(fakePad({ pressed: [15, 0] }));
  input.poll(16);
  assert.deepEqual(actions, ['right', 'confirm']);
  input.poll(60);
  assert.deepEqual(actions, ['right', 'confirm']);
  input.poll(120);
  input.poll(180);
  assert.deepEqual(actions, ['right', 'confirm', 'right', 'right']);
  set(fakePad());
  input.poll(200);
  set(fakePad({ pressed: [1] }));
  input.poll(216);
  assert.equal(actions.at(-1), 'back');
});

test('gamepad stick uses a deadzone and a single dominant axis', () => {
  const { actions, input, set } = harness();
  input.poll(0);
  set(fakePad({ axes: [0.3, 0.2] }));
  input.poll(16);
  assert.deepEqual(actions, []);
  set(fakePad({ axes: [0.9, -0.7] }));
  input.poll(32);
  assert.deepEqual(actions, ['right']);
});

test('gamepad ignores inputs held across a long polling gap', () => {
  const { actions, input, set } = harness();
  input.poll(0);
  set(fakePad({ pressed: [0] }));
  input.poll(5000);
  assert.deepEqual(actions, []);
  set(fakePad());
  input.poll(5016);
  set(fakePad({ pressed: [0] }));
  input.poll(5032);
  assert.deepEqual(actions, ['confirm']);
});

test('settings exposes controller pairing controls in the gamepad-navigable dialog', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../src/renderer/controller-service.js'), 'utf8');
  const wizard = fs.readFileSync(path.join(__dirname, '../src/renderer/pairing-wizard-ui.js'), 'utf8');
  assert.match(html, /data-page="controllers"/);
  for (const controlId of ['controller-list', 'pair-new-controller', 'refresh-controllers', 'controller-hint', 'pairing-dialog']) {
    assert.match(html, new RegExp(`id="${controlId}"`));
  }
  for (const transport of ['bluetooth', 'dongle', 'usb']) {
    assert.ok(wizard.includes(`'${transport}'`));
  }
  assert.match(app, /function settingsControls\(\)/);
  assert.match(app, /querySelectorAll\('button, input, select, textarea'\)/);
  assert.match(app, /window\.ControllersPage\.handleAction\(action\)/);
  assert.match(service, /onControllerPairingUpdate/);
});

const ThemeEngine = require('../src/renderer/theme');

test('renderer component styles use theme tokens for colours, radii and motion timing', () => {
  const styles = fs.readFileSync(path.join(__dirname, '../src/renderer/styles.css'), 'utf8');
  assert.doesNotMatch(styles, /#[\da-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(styles, /(?<![-\w])transparent(?![\w-])|hsl\(\s*[\d.]+/i);
  assert.doesNotMatch(styles, /border-radius\s*:\s*(?:0(?:\s|;)|[\d.]+(?:px|rem|em|%))/i);
  assert.doesNotMatch(styles, /(?:transition(?:-duration)?|animation)\s*:[^;]*(?:\d+ms|\d+s)/i);
  assert.match(styles, /--focus-scale/);
  assert.match(styles, /--motion-pulse/);
});

test('theme resolve applies defaults and rejects invalid values', () => {
  assert.deepEqual(ThemeEngine.resolve(undefined), { preset: 'console', accent: '', liveVideo: true, dynamicArt: true });
  assert.equal(ThemeEngine.resolve({ preset: 'nope' }).preset, 'console');
  assert.equal(ThemeEngine.resolve({ accent: 'red' }).accent, '');
  assert.equal(ThemeEngine.resolve({ accent: '#FF2BD6' }).accent, '#ff2bd6');
  assert.equal(ThemeEngine.resolve({ preset: 'oled' }).dynamicArt, false);
  assert.equal(ThemeEngine.resolve({ preset: 'oled', dynamicArt: true }).dynamicArt, true);
  assert.equal(ThemeEngine.resolve({ liveVideo: false }).liveVideo, false);
});

test('theme contrast colour and apply', () => {
  assert.equal(ThemeEngine.contrastColor('#ffffff'), '#05070d');
  assert.equal(ThemeEngine.contrastColor('#101040'), '#ffffff');
  const props = new Map();
  const element = { dataset: {}, style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
  ThemeEngine.apply(element, { preset: 'neon', accent: '#00f0ff' });
  assert.equal(element.dataset.theme, 'neon');
  assert.equal(props.get('--accent'), '#00f0ff');
  ThemeEngine.apply(element, { preset: 'oled' });
  assert.equal(props.has('--accent'), false);
});

const Wallpapers = require('../src/renderer/wallpapers');

const entries = ['a', 'b', 'c'].map((id) => ({ id, name: id, file: `wallpapers/${id}.webp`, thumb: `wallpapers/${id}.thumb.webp`, license: 'CC0', author: 'x', source: 'y' }));
const gallery = Wallpapers.createGallery(entries);

test('wallpaper settings are normalised', () => {
  assert.deepEqual(gallery.resolve(undefined), { mode: 'slideshow', id: 'a', intervalSec: 300, source: 'bundled', folderPath: '', folders: [], shuffle: true, online: false });
  const partial = gallery.resolve({ mode: 'slideshow', id: 'zzz', intervalSec: 60 });
  assert.deepEqual([partial.mode, partial.id, partial.intervalSec], ['slideshow', 'a', 60]);
  assert.equal(gallery.resolve({ mode: 'bundled', id: 'b', intervalSec: 7 }).intervalSec, 300);
  assert.equal(gallery.resolve({ mode: 'weird' }).mode, 'custom');
  assert.equal(gallery.resolve({}, 'custom').mode, 'custom');
  assert.equal(Wallpapers.createGallery([]).resolve({ mode: 'bundled' }).mode, 'custom');
});

test('wallpaper urls, slide index and shuffle', () => {
  assert.equal(gallery.urlFor(entries[1], 'file:///app/src/renderer/index.html'), 'file:///app/src/renderer/wallpapers/b.webp');
  assert.equal(gallery.urlFor(entries[1], 'file:///app/src/renderer/index.html', 'thumb'), 'file:///app/src/renderer/wallpapers/b.thumb.webp');
  assert.equal(gallery.nextIndex(2, 3), 0);
  assert.equal(gallery.nextIndex(0, 0), 0);
  const shuffled = Wallpapers.shuffle([1, 2, 3, 4, 5], () => 0.3);
  assert.deepEqual([...shuffled].sort(), [1, 2, 3, 4, 5]);
});

test('wallpaper folders, sources and slide plans are normalised', () => {
  const resolved = gallery.resolve({
    mode: 'slideshow', source: 'folder', folderPath: '/pics/b', shuffle: false, online: true,
    folders: [{ path: '/pics/a', name: ' Holidays ' }, { path: '/pics/b' }, { path: '/pics/a' }, { path: 'relative' }, null, { path: 'C:\\Walls', name: 5 }]
  });
  assert.deepEqual(resolved.folders.map((folder) => folder.path), ['/pics/a', '/pics/b', 'C:\\Walls']);
  assert.equal(resolved.folders[0].name, 'Holidays');
  assert.equal(resolved.folders[1].name, 'b');
  assert.equal(resolved.folders[2].name, 'Walls');
  assert.equal(resolved.shuffle, false);
  assert.deepEqual(Wallpapers.slidePlan(resolved), { bundled: false, folders: ['/pics/b'], online: false });
  assert.equal(gallery.resolve({ mode: 'slideshow', source: 'nonsense' }).source, 'bundled');
  assert.equal(gallery.resolve({ mode: 'slideshow', source: 'folder', folderPath: '/gone', folders: [{ path: '/pics/a' }] }).folderPath, '/pics/a');
});

test('slide plan falls back to bundled and mixes every pool', () => {
  const base = gallery.resolve({ mode: 'slideshow' });
  assert.deepEqual(Wallpapers.slidePlan({ ...base, source: 'folder' }), { bundled: true, folders: [], online: false });
  assert.deepEqual(Wallpapers.slidePlan({ ...base, source: 'online', online: false }), { bundled: true, folders: [], online: false });
  assert.deepEqual(Wallpapers.slidePlan({ ...base, source: 'online', online: true }), { bundled: false, folders: [], online: true });
  const mixed = { ...base, source: 'mixed', online: true, folders: [{ path: '/a', name: 'a' }, { path: '/b', name: 'b' }] };
  assert.deepEqual(Wallpapers.slidePlan(mixed), { bundled: true, folders: ['/a', '/b'], online: true });
});

test('playback order is sequential or a full permutation', () => {
  assert.deepEqual(Wallpapers.playbackOrder(4, false), [0, 1, 2, 3]);
  assert.deepEqual([...Wallpapers.playbackOrder(50, true)].sort((a, b) => a - b), Array.from({ length: 50 }, (_unused, i) => i));
  assert.deepEqual(Wallpapers.playbackOrder(0, true), []);
});
