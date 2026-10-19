'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '../src/renderer');
const read = (name) => fs.readFileSync(path.join(RENDERER, name), 'utf8');

test('settings files mark every clickable choice with .pointer-target', () => {
  const dialog = read('settings.js');
  // Generated buttons that carry a click handler.
  for (const marker of [
    "'remove pointer-target'",          // removeButton() and the source-row remove
    "'select-trigger pointer-target'",  // compact select trigger
    "'select-option pointer-target'",   // compact select options (theme, font, layout choices)
    "'swatch pointer-target'",          // accent colour swatches
    "'wallpaper-thumb pointer-target'", // bundled wallpaper thumbnails
    "'source-toggle pointer-target'",   // wallpaper source On/Off toggle
    "className: 'pointer-target'"      // plain choice buttons (category, preset accent, intervals, providers)
  ]) {
    assert.ok(dialog.includes(marker), `settings.js should contain ${marker}`);
  }
  // The static buttons that already had a click handler get the class in init().
  assert.ok(/classList\.add\('pointer-target'\)/.test(dialog), 'settings.js should add the class to static buttons in init()');

  const appearance = read('settings-appearance.js');
  assert.ok(appearance.includes('${className} pointer-target'), 'settings-appearance.js should build action buttons with the class');
  assert.ok(appearance.includes("document.querySelectorAll('#header-layout button').forEach((node) => node.classList.add('pointer-target'))"),
    'settings-appearance.js should mark the header-layout choice buttons');
});

test('adding .pointer-target did not change the number of click handlers', () => {
  const countClicks = (source) => (source.match(/addEventListener\('click'/g) || []).length;
  // Recorded before the R11 mouse-mode change: the class was added, no handler was touched.
  assert.equal(countClicks(read('settings.js')), 25, 'settings.js click-listener count changed');
  assert.equal(countClicks(read('settings-appearance.js')), 3, 'settings-appearance.js click-listener count changed');
});
