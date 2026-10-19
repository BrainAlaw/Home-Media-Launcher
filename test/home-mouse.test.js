'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rendererDir = path.join(__dirname, '..', 'src', 'renderer');

function readRendererFile(file) {
  return fs.readFileSync(path.join(rendererDir, file), 'utf8').replace(/\r\n/g, '\n');
}

/** Extracts a top-level `function name(...) { ... }` declaration from a classic script (the first closing brace at column 0). */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} must exist`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `function ${name} must close at column 0`);
  return source.slice(start, end + 2);
}

test('wheel mapping turns a vertical wheel into horizontal track scrolling', () => {
  const source = readRendererFile('app.js');
  const context = vm.createContext({});
  vm.runInContext(extractFunction(source, 'homeWheelToHorizontal'), context);
  const map = context.homeWheelToHorizontal;

  assert.equal(map({ deltaX: 0, deltaY: 120 }), 120, 'a vertical wheel step scrolls by its deltaY');
  assert.equal(map({ deltaX: 0, deltaY: -120 }), -120, 'scrolling up moves the track back');
  assert.equal(map({ deltaX: 35, deltaY: 120 }), 35, 'a horizontal delta (trackpad) wins over the vertical one');
  assert.equal(map({ deltaX: 0, deltaY: 0 }), 0, 'no movement gives no scroll');
});

test('the home wheel listener scrolls .track elements through the mapping and passes through at the ends', () => {
  const source = readRendererFile('app.js');
  const start = source.indexOf("homeElement.addEventListener('wheel'");
  assert.notEqual(start, -1, 'home wheel listener must exist');
  const block = source.slice(start, source.indexOf('}, { passive: false });', start));

  assert.match(block, /closest\?\.\('\.track'\)/, 'only tile tracks are affected');
  assert.match(block, /homeWheelToHorizontal\(event\)/, 'the wheel uses the shared mapping');
  assert.match(block, /if \(next === track\.scrollLeft\) return;/, 'at the end of the track the page keeps the native scroll');
  assert.match(block, /event\.preventDefault\(\)/, 'a consumed wheel step does not also scroll the page');
});

test('a tile click runs the same confirm action as Enter', () => {
  const source = readRendererFile('app.js');

  assert.match(source, /Enter: 'confirm'/, 'Enter maps to the confirm action');

  const clickStart = source.indexOf("homeElement.addEventListener('click'");
  assert.notEqual(clickStart, -1, 'home click listener must exist');
  const clickBlock = source.slice(clickStart, source.indexOf('});', clickStart));
  assert.match(clickBlock, /setFocus\(element\);\s*handleAction\('confirm'\);/, 'click focuses the tile and sends confirm, like Enter');
  assert.doesNotMatch(clickBlock, /activate\(element\)/, 'click does not call activate directly');

  const handleStart = source.indexOf('function handleAction(action)');
  const handleBlock = source.slice(handleStart, source.indexOf('\n}\n', handleStart));
  assert.match(handleBlock, /else if \(action === 'confirm'\) activate\(state\.focusEl\);/, 'confirm activates the focused tile');
});

test('tiles are pointer targets and keep the tile hover instead of the shared fill', () => {
  const app = readRendererFile('app.js');
  assert.match(app, /button\.className = 'tile pointer-target';/);

  const home = readRendererFile('home.css');
  assert.match(home, /\.tile\.pointer-target:hover \{ background: none; \}/);

  const pointer = readRendererFile('pointer-target.css');
  assert.match(pointer, /\.pointer-target:hover \{\s*background: var\(--hig-fill\);\s*cursor: pointer;\s*\}/);

  const html = readRendererFile('index.html');
  assert.match(html, /<link rel="stylesheet" href="pointer-target\.css">/);
});
