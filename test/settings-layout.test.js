'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('src/renderer/index.html');
const settings = read('src/renderer/settings.js');

test('settings navigation merges Themes and Fonts into Appearance and drops the Icons page', () => {
  const pages = [...html.matchAll(/<button type="button" data-page="([\w-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(pages, ['general', 'appearance', 'wallpapers', 'applications', 'remote', 'websites', 'controllers']);
  for (const page of pages) assert.match(html, new RegExp(`<section class="settings-page[^"]*" data-page="${page}"`));
  assert.doesNotMatch(html, /id="icon-editor"|data-page="(?:themes|fonts|icons)"/);
});

test('Appearance keeps every id used by settings.js and theme previews', () => {
  const appearance = html.slice(html.indexOf('<section class="settings-page" data-page="appearance"'), html.indexOf('<section class="settings-page" data-page="wallpapers"'));
  for (const id of ['appearance-preview', 'preset-picker', 'accent-picker', 'font-picker', 'dynamic-art', 'live-video']) {
    assert.match(appearance, new RegExp(`id="${id}"`));
    if (id !== 'appearance-preview') assert.match(settings, new RegExp(`#${id}`));
  }
});

test('every element id queried by settings.js exists in the markup or is created by the script', () => {
  const queried = new Set([...settings.matchAll(/\$\('#([\w-]+)'\)/g)].map((match) => match[1]));
  const created = new Set([...settings.matchAll(/id: '([\w-]+)'/g)].map((match) => match[1]));
  for (const id of queried) assert.ok(html.includes(`id="${id}"`) || created.has(id), `missing #${id}`);
});

test('wallpaper sources editor and credit overlay are wired in the page', () => {
  for (const id of ['wallpaper-sources', 'add-wallpaper-folder', 'online-source-url', 'add-online-source', 'known-providers', 'wallpaper-credit-toggle', 'wallpaper-credit-overlay', 'clear-online-wallpapers']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const script of ['wallpaper-sources.js', 'wallpaper-credit.js', 'appearance.css']) assert.ok(html.includes(script));
  assert.ok(html.indexOf('wallpaper-sources.js') < html.indexOf('settings.js'));
});

test('icon editor offers Auto, Browse, Search artwork and the size hint, and degrades when the icons namespace is missing', () => {
  for (const label of ['Auto', 'Browse…', 'Search artwork']) assert.ok(settings.includes(`'${label}'`), label);
  assert.match(settings, /callExt\('icons', 'resolve'/);
  assert.match(settings, /callExt\('icons', 'searchArtwork'/);
  assert.match(settings, /1280×720/);
  assert.match(settings, /512×512/);
  assert.match(settings, /600×900/);
  assert.match(settings, /catch \{ setStatus\('Automatic icons are not available/);
});

test('new stylesheet only uses theme tokens for colours, radii and motion', () => {
  const css = read('src/renderer/appearance.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(css, /(?<![-\w])transparent(?![\w-])/i);
  assert.doesNotMatch(css, /border-radius\s*:\s*(?:0(?:\s|;)|[\d.]+(?:px|rem|em|%))/i);
  assert.doesNotMatch(css, /(?:transition(?:-duration)?|animation)\s*:[^;]*(?:\d+ms|\d+s)/i);
});
