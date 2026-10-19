'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererFiles = [
  'menu.css',
  'styles.css',
  'status.css',
  'status-widgets.js'
];

function readRendererFile(file) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', file), 'utf8');
}

function findFocusSelectors(source) {
  const rules = [];
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /(?:^|[{}])([^{}]+)\{([^{}]*)\}/g;

  for (const match of css.matchAll(rulePattern)) {
    for (const selector of match[1].split(',')) {
      const trimmedSelector = selector.trim();
      if (/:focus(?:-visible|-within)?\b/.test(trimmedSelector)) {
        rules.push({
          selector: trimmedSelector,
          declarations: match[2].replace(/\s+/g, ' ').trim()
        });
      }
    }
  }

  return rules;
}

test('quick-settings focus selectors follow the shared row contract', () => {
  const files = new Map(rendererFiles.map((file) => [file, readRendererFile(file)]));
  const focusRules = new Map(
    [...files].map(([file, source]) => [file, findFocusSelectors(source)])
  );
  const allFocusRules = [...focusRules].flatMap(([file, rules]) =>
    rules.map((rule) => ({ file, ...rule }))
  );
  const sharedRowRules = allFocusRules.filter(({ selector }) => selector.includes('.qs-row'));
  const canonicalRules = allFocusRules.filter(
    ({ selector }) => selector === '.qs-row:is(:focus, :focus-visible)'
  );

  assert.ok(
    sharedRowRules.length > 0,
    'No focus selector mentions .qs-row in the Quick settings renderer files'
  );
  assert.equal(
    canonicalRules.length,
    1,
    'Expected exactly one focus selector `.qs-row:is(:focus, :focus-visible)`'
  );

  for (const { file, selector, declarations } of sharedRowRules) {
    assert.equal(
      declarations,
      canonicalRules[0].declarations,
      `${file}: focus selector "${selector}" does not use the shared .qs-row declaration block`
    );
  }

  for (const { file, selector } of allFocusRules) {
    assert.ok(
      !selector.includes('.qs-info'),
      `${file}: informational selector "${selector}" must not have a focus rule`
    );
    assert.ok(
      !/(?:#tailscale|#surfshark|\.vpn|tailscale-indicator|surfshark-indicator)/i.test(selector),
      `${file}: VPN selector "${selector}" must use the shared .qs-row focus rule`
    );
  }
});
