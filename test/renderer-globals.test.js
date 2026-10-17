'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = path.join(__dirname, '..', 'src', 'renderer');
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');

/**
 * Classic <script> files share one global lexical scope: a second top-level `const X` in any later file throws a
 * SyntaxError and the whole file silently fails to load (which once broke the entire home screen).
 */
test('renderer scripts declare no duplicate top-level names', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.length > 20);
  const owners = new Map();
  for (const script of scripts) {
    const source = fs.readFileSync(path.join(renderer, script), 'utf8').replace(/\r\n/g, '\n');
    for (const match of source.matchAll(/^(?:const|let|class|function\*?|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = match[1];
      assert.ok(!owners.has(name) || owners.get(name) === script, `top-level name "${name}" is declared in both ${owners.get(name)} and ${script}`);
      owners.set(name, script);
    }
  }
});

test('every script and stylesheet referenced by index.html exists', () => {
  for (const match of html.matchAll(/(?:src|href)="([^"#?:]+\.(?:js|css))"/g)) {
    assert.ok(fs.existsSync(path.join(renderer, match[1])), `missing ${match[1]}`);
  }
});
