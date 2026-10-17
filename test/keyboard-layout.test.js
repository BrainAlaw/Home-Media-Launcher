'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../src/renderer/keyboard-layout');

const idsOf = (layout, row) => layout.rows[row].keys.map((key) => key.id);

test('every row of every layer fills the ten-unit grid', () => {
  for (const layer of ['letters', 'symbols1', 'symbols2']) {
    const layout = K.buildLayout({ layer });
    layout.rows.forEach((row, index) => {
      const used = row.keys.reduce((sum, key) => sum + key.width, 0);
      const expected = index === 2 ? K.ROW_UNITS - 1 : K.ROW_UNITS;
      assert.equal(used, expected, `${layer} row ${index}`);
      assert.equal(row.keys[0].x, row.offset);
    });
  }
});

test('letters layer exposes digits, q-p, a-l, z-m and the helper keys', () => {
  const layout = K.buildLayout();
  assert.equal(layout.rows[1].keys.map((key) => key.label).join(''), 'qwertyuiop');
  assert.equal(layout.rows[2].keys.map((key) => key.label).join(''), 'asdfghjkl');
  assert.equal(layout.rows[3].keys.map((key) => key.label).join(''), '\u21e7zxcvbnm\u232b');
  assert.deepEqual(idsOf(layout, 4), ['layer:symbols', 'char:@', 'space', 'char:.', 'char:.com', 'done']);
});

test('search type relabels the submit key', () => {
  assert.equal(K.buildLayout({ type: 'search' }).rows[4].keys.at(-1).label, 'Search');
  assert.equal(K.buildLayout({ type: 'text' }).rows[4].keys.at(-1).label, 'Done');
});

test('shifted layout upper-cases letters only', () => {
  const layout = K.buildLayout({ shifted: true });
  assert.equal(layout.rows[1].keys[0].insert, 'Q');
  assert.equal(layout.rows[0].keys[0].insert, '1');
});

test('left and right wrap inside a row', () => {
  const layout = K.buildLayout();
  const first = { row: 1, col: 0, anchor: 0.5 };
  assert.equal(K.move(layout, first, 'left').col, 9);
  assert.equal(K.move(layout, { row: 1, col: 9, anchor: 9.5 }, 'right').col, 0);
});

test('up and down wrap across rows and keep the horizontal anchor', () => {
  const layout = K.buildLayout();
  const top = { row: 0, col: 4, anchor: 4.5 };
  assert.equal(K.move(layout, top, 'up').row, layout.rows.length - 1);
  assert.equal(K.move(layout, { row: 4, col: 2, anchor: 4 }, 'down').row, 0);
  // From 'p' (x 9.5) down to the offset a-l row lands on 'l', then back up returns to 'p' via the anchor.
  const p = { row: 1, col: 9, anchor: 9.5 };
  const down = K.move(layout, p, 'down');
  assert.equal(layout.rows[2].keys[down.col].label, 'l');
  assert.equal(layout.rows[1].keys[K.move(layout, down, 'up').col].label, 'p');
});

test('wide keys are reachable from the keys above them', () => {
  const layout = K.buildLayout();
  const m = layout.rows[3].keys.findIndex((key) => key.label === 'm');
  const down = K.move(layout, { row: 3, col: m, anchor: layout.rows[3].keys[m].x + 0.5 }, 'down');
  assert.equal(layout.rows[4].keys[down.col].id, 'char:.com');
});

test('position survives a layer change by key id, with clamped fallback', () => {
  const letters = K.buildLayout();
  const symbols = K.buildLayout({ layer: 'symbols1' });
  assert.equal(K.locate(symbols, 'backspace', { row: 3, col: 8 }).col, 8);
  assert.deepEqual(K.locate(symbols, 'missing', { row: 9, col: 99 }).row, symbols.rows.length - 1);
  assert.ok(letters.rows.length === symbols.rows.length);
});

test('typing, backspace and code point safety', () => {
  const layout = K.buildLayout();
  let state = K.createState('ab');
  state = K.press(state, layout.rows[1].keys[0]).state;
  assert.equal(state.text, 'abq');
  state = K.backspace(K.insert(state, '\u{1F3B5}'));
  assert.equal(state.text, 'abq');
  assert.equal(K.backspace(K.createState('')).text, '');
});

test('shift cycles off -> once -> lock -> off and once is consumed by a letter', () => {
  const shiftKey = { kind: 'shift' };
  let state = K.createState();
  state = K.press(state, shiftKey).state; assert.equal(state.shift, 'once');
  state = K.press(state, K.buildLayout({ shifted: true }).rows[1].keys[0]).state;
  assert.equal(state.text, 'Q'); assert.equal(state.shift, 'off');
  state = K.press(K.press(state, shiftKey).state, shiftKey).state; assert.equal(state.shift, 'lock');
  state = K.press(state, K.buildLayout({ shifted: true }).rows[1].keys[1]).state;
  assert.equal(state.shift, 'lock');
  assert.equal(K.press(state, shiftKey).state.shift, 'off');
});

test('layer keys switch layers and done submits', () => {
  const letters = K.buildLayout();
  let state = K.press(K.createState(), letters.rows[4].keys[0]).state;
  assert.equal(state.layer, 'symbols1');
  const symbols = K.buildLayout({ layer: state.layer });
  state = K.press(state, symbols.rows[3].keys[0]).state;
  assert.equal(state.layer, 'symbols2');
  assert.equal(K.isShifted(state), false);
  assert.equal(K.press(state, letters.rows[4].keys.at(-1)).submit, true);
});

test('url helper keys insert whole fragments', () => {
  const layout = K.buildLayout();
  const state = K.press(K.createState('example'), layout.rows[4].keys.find((key) => key.id === 'char:.com')).state;
  assert.equal(state.text, 'example.com');
});

test('isPrintable accepts single characters without modifiers', () => {
  assert.equal(K.isPrintable({ key: 'a' }), true);
  assert.equal(K.isPrintable({ key: ' ' }), true);
  assert.equal(K.isPrintable({ key: 'Enter' }), false);
  assert.equal(K.isPrintable({ key: 'c', ctrlKey: true }), false);
});
