'use strict';

// Enforces the HIG token layer (src/renderer/hig.css, documented in backend/DESIGN.md):
//  1. animation hygiene across the owned stylesheets (no `transition: all`, no layout properties, restricted will-change / backdrop-filter);
//  2. WCAG AA contrast of the vibrancy label levels on every material in every theme.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDERER = path.join(__dirname, '../../src/renderer');
const OWNED = ['styles.css', 'home.css', 'controllers.css', 'launch-transition.css', 'hig.css', 'theme.css'];
/** Files where every transition may only touch compositor properties. */
const COMPOSITOR_ONLY_FILES = new Set(['home.css', 'launch-transition.css']);
const COMPOSITOR_PROPS = new Set(['transform', 'opacity', 'visibility', 'none']);
const LAYOUT_PROPS = /^(width|height|min-|max-|top|left|right|bottom|inset|margin|padding|border(-\w+)?-width|font|line-height|letter-spacing|gap|flex|grid|display|position)/;

const read = (name) => fs.readFileSync(path.join(RENDERER, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Flat list of `{ selector, prop, value }` for every declaration (at-rules are flattened). */
function declarations(css) {
  const out = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rule.exec(css))) {
    const selector = match[1].trim();
    for (const decl of match[2].split(/;(?![^(]*\))/)) {
      const index = decl.indexOf(':');
      if (index > 0) out.push({ selector, prop: decl.slice(0, index).trim().toLowerCase(), value: decl.slice(index + 1).trim() });
    }
  }
  return out;
}

const splitTopLevel = (value) => {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

const transitionedProps = (decl) => {
  if (decl.prop === 'transition-property') return splitTopLevel(decl.value);
  if (decl.prop === 'transition') return splitTopLevel(decl.value).map((part) => part.split(/\s+/)[0]);
  return [];
};

test('owned stylesheets never use transition: all or animate layout properties', () => {
  for (const file of OWNED) {
    for (const decl of declarations(read(file))) {
      for (const prop of transitionedProps(decl)) {
        const where = `${file}: ${decl.selector} { ${decl.prop}: ${decl.value} }`;
        assert.notEqual(prop, 'all', `transition: all in ${where}`);
        assert.ok(!LAYOUT_PROPS.test(prop), `layout property "${prop}" transitioned in ${where}`);
        const strict = COMPOSITOR_ONLY_FILES.has(file) || /\.tile\b/.test(decl.selector);
        if (strict && !prop.startsWith('var(')) assert.ok(COMPOSITOR_PROPS.has(prop), `only transform/opacity may transition in ${where}`);
      }
    }
  }
});

test('keyframes animate only transform, opacity and visibility', () => {
  const allowed = new Set(['transform', 'opacity', 'visibility', 'animation-timing-function']);
  for (const file of OWNED) {
    const css = read(file);
    const frames = /@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\}/g;
    let match;
    while ((match = frames.exec(css))) {
      for (const decl of declarations(match[2])) {
        assert.ok(allowed.has(decl.prop), `@keyframes ${match[1]} in ${file} animates "${decl.prop}"`);
      }
    }
  }
});

test('will-change is limited to focus/open states and backdrop-filter to the single menu surface', () => {
  for (const file of OWNED) {
    for (const decl of declarations(read(file))) {
      if (decl.prop === 'will-change') {
        assert.match(decl.selector, /:focus|\.focused|\.open|lt-covering/, `will-change on a resting element: ${file}: ${decl.selector}`);
      }
      if (decl.prop === 'backdrop-filter' || decl.prop === '-webkit-backdrop-filter') {
        const allowed = decl.value === 'none' || /\.menu-panel/.test(decl.selector);
        assert.ok(allowed, `extra live blur surface: ${file}: ${decl.selector}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------------------------- contrast

function parseColour(raw) {
  const value = raw.trim().toLowerCase();
  let match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (match) {
    const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join('') : match[1];
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
  if (match) return { r: +match[1], g: +match[2], b: +match[3], a: match[4] === undefined ? 1 : +match[4] };
  return null;
}

const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1
});
const lum = ({ r, g, b }) => {
  const [lr, lg, lb] = [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

function themeTokens() {
  const css = read('theme.css');
  const tokens = new Map();
  const block = /((?::root,\s*)?\[data-theme="([\w-]+)"\])\s*\{([^{}]*)\}/g;
  let match;
  while ((match = block.exec(css))) {
    const props = {};
    for (const decl of match[3].split(';')) {
      const index = decl.indexOf(':');
      if (index > 0) props[decl.slice(0, index).trim()] = decl.slice(index + 1).trim();
    }
    if (props['--text']) tokens.set(match[2], props);
  }
  return tokens;
}

test('vibrancy labels meet WCAG AA on every material in every built-in theme', () => {
  const hig = read('hig.css');
  const alphas = Object.fromEntries([...hig.matchAll(/--hig-material-(\w+):[^;]*bg-elevated\)\s*(\d+)%/g)].map((m) => [m[1], +m[2] / 100]));
  assert.deepEqual(Object.keys(alphas).sort(), ['regular', 'thick', 'thin', 'ultrathin']);
  assert.ok(alphas.ultrathin < alphas.thin && alphas.thin < alphas.regular && alphas.regular < alphas.thick, 'alpha rises with thickness');

  const themes = themeTokens();
  assert.ok(themes.size >= 40, `parsed ${themes.size} theme blocks`);
  const levels = (name) => +new RegExp(String.raw`--hig-label-${name}: color-mix\(in srgb, var\(--text\) (\d+)%`).exec(hig)[1] / 100;
  const SECONDARY = levels('secondary');
  const TERTIARY = levels('tertiary');
  assert.ok(SECONDARY > TERTIARY, 'label levels fall with vibrancy');
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const BLACK = { r: 0, g: 0, b: 0, a: 1 };
  const MIN_BACKDROP_DIM = 0.46; // the lowest --backdrop-dim of any preset: wallpapers always sit under .shade
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  for (const [id, props] of themes) {
    const colours = {};
    for (const key of ['--bg', '--bg-elevated', '--text']) {
      colours[key] = parseColour(props[key] || '');
      assert.ok(colours[key], `${id}: cannot parse ${key} = ${props[key]}`);
    }
    for (const material of ['thin', 'regular', 'thick']) {
      // Worst case: the wallpaper behind the material is pure white or pure black (whichever hurts more).
      for (const extreme of [WHITE, BLACK]) {
        const behind = over({ ...colours['--bg'], a: MIN_BACKDROP_DIM }, extreme);
        const base = over({ ...colours['--bg-elevated'], a: alphas[material] }, behind);
        const surface = over({ ...colours['--text'], a: 0.07 }, base); // top highlight
        const text = (alpha) => over({ ...colours['--text'], a: alpha }, surface);
        const where = `${id} ${material} over ${extreme === WHITE ? 'white' : 'black'}`;
        check(ratio(text(1), surface) >= 4.5, `${where}: label`);
        check(ratio(text(SECONDARY), surface) >= 4.5, `${where}: secondary label ${ratio(text(SECONDARY), surface).toFixed(2)}`);
        check(ratio(text(TERTIARY), surface) >= 3, `${where}: tertiary label ${ratio(text(TERTIARY), surface).toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
