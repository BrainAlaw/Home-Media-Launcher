'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { clickAction } = require('../src/renderer/mouse-mode-model');

const widgetSource = fs.readFileSync(path.join(__dirname, '../src/renderer/media-widget.js'), 'utf8');

function fakeElement(tagName, classes = []) {
  const names = new Set(classes);
  return { tagName, classList: { contains: (name) => names.has(name) } };
}

test('media card click requests focus and dispatches the focused activation', () => {
  assert.match(widgetSource, /card\.addEventListener\('click', \(\) => \{[\s\S]*?if \(!view\.interactive\) return;[\s\S]*?requestFocus\(root\);[\s\S]*?handleAction\('activate'\);/);
  assert.match(widgetSource, /function handleAction\(action\) \{\s*const effect = focusModel\.handle\(action\);[\s\S]*?effect\.type === 'activate'[\s\S]*?activate\(effect\.id\)/);
});

test('media card and generated buttons are pointer targets', () => {
  const card = fakeElement('DIV', ['mw-card', 'pointer-target']);
  const button = fakeElement('BUTTON', ['mw-btn', 'pointer-target']);
  const plainCopy = fakeElement('DIV', ['mw-text']);
  assert.match(widgetSource, /el\('div', 'mw-card pointer-target'\)/);
  assert.match(widgetSource, /`mw-btn mw-\$\{id\} pointer-target`/);
  assert.equal(clickAction(card), 'activate');
  assert.equal(clickAction(button), 'activate');
  assert.equal(clickAction(plainCopy), null);
});
