'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const renderer = (file) => readFileSync(join(__dirname, '..', 'src', 'renderer', file), 'utf8');

function countKeydownHandlers(source) {
  return (source.match(/addEventListener\s*\(\s*['"]keydown['"]/g) || []).length;
}

test('pairing wizard buttons and transport choices have pointer targets', () => {
  const source = renderer('pairing-wizard-ui.js');
  assert.match(source, /node\('button',\s*primary\s*\?\s*'primary pointer-target'\s*:\s*'pointer-target'/);
  assert.match(source, /node\('button',\s*'chip pointer-target'/);
});

test('controller page actions and controller rows have pointer targets', () => {
  const page = renderer('controllers-page.js');
  const list = renderer('controller-list.js');
  assert.match(page, /\$\('#pair-new-controller'\)\.classList\.add\('pointer-target'\)/);
  assert.match(page, /\$\('#refresh-controllers'\)\.classList\.add\('pointer-target'\)/);
  assert.match(list, /element\.className\s*=\s*'device-row pointer-target'/);
});

test('pairing and controller files retain their original keydown handler counts', () => {
  const expectedCounts = {
    'pairing-wizard-ui.js': 0,
    'controllers-page.js': 0,
    'controller-list.js': 0
  };

  for (const [file, expected] of Object.entries(expectedCounts)) {
    assert.equal(countKeydownHandlers(renderer(file)), expected, `${file} keydown handler count changed`);
  }
});
