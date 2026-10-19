'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PANEL_DIR = path.join(__dirname, '..', 'src', 'main', 'admin', 'panel');

/** Rules that must never appear in panel `.js` and `.css` sources (checked after comments are stripped). */
const CODE_RULES = [
  ['eval(', /\beval\s*\(/],
  ['new Function(', /\bnew\s+Function\s*\(/],
  ['innerHTML', /\binnerHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\s*\.\s*write/],
  ['url(http', /url\(\s*["']?http/i],
  ['@import with a URL', /@import[^;\n]*(?:https?:)?\/\//i],
  ['expression(', /\bexpression\s*\(/]
];

/** 1-based line number of `index` inside `source`. */
function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Replaces line comments (`//`) and block comments (`/* ... ` + `/`) with spaces, keeping newlines
 * so reported line numbers stay correct.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) { out += source[i] === '\n' ? '\n' : ' '; i += 1; }
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** Collects CSP-unsafe constructs in one HTML file as `"<rule> at line <n>"` strings. */
function htmlViolations(name, source) {
  const found = [];
  const add = (rule, index) => found.push(`${name}: ${rule} at line ${lineOf(source, index)}`);

  for (const match of source.matchAll(/<script\b([^>]*)>/gi)) {
    const attributes = match[1];
    if (!/\bsrc\s*=/i.test(attributes) && !/type\s*=\s*["']application\/json["']/i.test(attributes)) {
      add('inline <script> without src', match.index);
    }
  }
  const inlineHandler = /\son[a-z]+\s*=/i.exec(source);
  if (inlineHandler) add('inline event handler', inlineHandler.index);
  const styleAttribute = /\sstyle\s*=/i.exec(source);
  if (styleAttribute) add('style= attribute', styleAttribute.index);
  const javascriptUrl = /javascript:/i.exec(source);
  if (javascriptUrl) add('javascript: URL', javascriptUrl.index);
  const externalRef = /(src|href)\s*=\s*["']?(https?:)?\/\//i.exec(source);
  if (externalRef) add('external reference', externalRef.index);

  for (const match of source.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const target = match[1];
    if (/^(?:https?:|data:|#)/i.test(target)) continue;
    const relative = target.replace(/^\/+/, '');
    if (relative.includes('/') || relative.startsWith('.') || !fs.existsSync(path.join(PANEL_DIR, relative))) {
      add(`reference to missing file "${target}"`, match.index);
    }
  }
  return found;
}

/** Collects banned constructs in one JS or CSS file (comments stripped first). */
function codeViolations(name, source) {
  const checked = stripComments(source);
  const found = [];
  for (const [rule, pattern] of CODE_RULES) {
    const match = pattern.exec(checked);
    if (match) found.push(`${name}: ${rule} at line ${lineOf(checked, match.index)}`);
  }
  return found;
}

test('admin panel sources stay safe under default-src \'self\'', () => {
  const files = fs.readdirSync(PANEL_DIR)
    .filter((entry) => /\.(?:html|js|css)$/i.test(entry))
    .sort();
  assert.ok(files.length > 0, `no .html, .js or .css files found in ${PANEL_DIR}`);

  const violations = [];
  for (const name of files) {
    const source = fs.readFileSync(path.join(PANEL_DIR, name), 'utf8');
    if (/\.html$/i.test(name)) violations.push(...htmlViolations(name, source));
    else violations.push(...codeViolations(name, source));
  }
  assert.deepEqual(violations, [], `panel CSP rule violations:\n${violations.join('\n')}`);
});
