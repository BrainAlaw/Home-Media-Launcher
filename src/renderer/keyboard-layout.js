(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KeyboardLayout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Pure (DOM-free) model of the on-screen keyboard: layers, key geometry, d-pad navigation and text editing.
   * Widths are in key units; every row is exactly ROW_UNITS wide (a row may start at an offset).
   *
   * @typedef {'letters'|'symbols1'|'symbols2'} LayerName
   * @typedef {'char'|'shift'|'backspace'|'layer'|'space'|'done'} KeyKind
   * @typedef {{ id: string, kind: KeyKind, label: string, width: number, insert?: string, layer?: LayerName,
   *   x?: number, ariaLabel?: string }} Key
   * @typedef {{ offset: number, keys: Key[] }} Row
   * @typedef {{ rows: Row[], layer: LayerName, shifted: boolean }} Layout
   * @typedef {{ row: number, col: number, anchor: number }} Position  anchor = horizontal centre kept across vertical moves
   * @typedef {{ text: string, layer: LayerName, shift: 'off'|'once'|'lock' }} KeyboardState
   */

  const ROW_UNITS = 10;
  const DIGITS = '1234567890'.split('');

  const SYMBOLS = {
    symbols1: [
      '-/:;()$&@"'.split(''),
      ".,?!'_~`|".split(''),
      '<>=+*%^'.split('')
    ],
    symbols2: [
      '[]{}#%^*+='.split(''),
      '_\\|~<>€£¥'.split(''),
      '·•…¿¡§°'.split('')
    ]
  };
  const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((row) => row.split(''));

  const charKey = (value, shifted) => {
    const isLetter = value.toLowerCase() !== value.toUpperCase();
    const label = isLetter && shifted ? value.toLocaleUpperCase() : value;
    return { id: `char:${value}`, kind: 'char', label, insert: label, width: 1 };
  };
  const literalKey = (value, width = 1, id = `char:${value}`) => ({ id, kind: 'char', label: value, insert: value, width });

  /** @param {Key[]} keys @param {number} offset @returns {Row} */
  function makeRow(keys, offset = 0) {
    let x = offset;
    for (const key of keys) { key.x = x; x += key.width; }
    return { offset, keys };
  }

  /**
   * @param {{ layer?: LayerName, shifted?: boolean, type?: 'text'|'search' }} [options]
   * @returns {Layout}
   */
  function buildLayout({ layer = 'letters', shifted = false, type = 'text' } = {}) {
    const rows = [makeRow(DIGITS.map((digit) => literalKey(digit)))];
    if (layer === 'letters') {
      rows.push(makeRow(LETTER_ROWS[0].map((value) => charKey(value, shifted))));
      rows.push(makeRow(LETTER_ROWS[1].map((value) => charKey(value, shifted)), 0.5));
      rows.push(makeRow([
        { id: 'shift', kind: 'shift', label: '⇧', width: 1.5, ariaLabel: 'Shift' },
        ...LETTER_ROWS[2].map((value) => charKey(value, shifted)),
        { id: 'backspace', kind: 'backspace', label: '⌫', width: 1.5, ariaLabel: 'Delete' }
      ]));
    } else {
      const [first, second, third] = SYMBOLS[layer];
      rows.push(makeRow(first.map((value) => literalKey(value))));
      rows.push(makeRow(second.map((value) => literalKey(value)), 0.5));
      rows.push(makeRow([
        { id: 'layer:toggle', kind: 'layer', label: layer === 'symbols1' ? '#+=' : '123', width: 1.5, layer: layer === 'symbols1' ? 'symbols2' : 'symbols1' },
        ...third.map((value) => literalKey(value)),
        { id: 'backspace', kind: 'backspace', label: '⌫', width: 1.5, ariaLabel: 'Delete' }
      ]));
    }
    rows.push(makeRow([
      layer === 'letters'
        ? { id: 'layer:symbols', kind: 'layer', label: '123', width: 1.5, layer: 'symbols1' }
        : { id: 'layer:letters', kind: 'layer', label: 'ABC', width: 1.5, layer: 'letters' },
      literalKey('@'),
      { id: 'space', kind: 'space', label: 'space', width: 3.5, insert: ' ', ariaLabel: 'Space' },
      literalKey('.'),
      literalKey('.com', 1.5, 'char:.com'),
      { id: 'done', kind: 'done', label: type === 'search' ? 'Search' : 'Done', width: 1.5 }
    ]));
    return { rows, layer, shifted };
  }

  const keyCentre = (key) => (key.x || 0) + key.width / 2;

  /** Nearest key in `row` to a horizontal centre (a key containing the centre wins). */
  function keyAt(row, centre) {
    let best = 0;
    let bestDistance = Infinity;
    row.keys.forEach((key, index) => {
      const start = key.x || 0;
      const distance = centre >= start && centre <= start + key.width ? 0 : Math.min(Math.abs(centre - start), Math.abs(centre - (start + key.width)));
      if (distance < bestDistance - 1e-9) { best = index; bestDistance = distance; }
    });
    return best;
  }

  /** @param {Layout} layout @param {Position} position @returns {Position} clamped, with a fresh anchor */
  function clampPosition(layout, position) {
    const row = Math.min(Math.max(0, position.row), layout.rows.length - 1);
    const col = Math.min(Math.max(0, position.col), layout.rows[row].keys.length - 1);
    return { row, col, anchor: keyCentre(layout.rows[row].keys[col]) };
  }

  /** Position of the key with `id`, or a clamped fallback (used when the layer changes under the cursor). */
  function locate(layout, id, fallback) {
    for (let r = 0; r < layout.rows.length; r++) {
      const c = layout.rows[r].keys.findIndex((key) => key.id === id);
      if (c >= 0) return { row: r, col: c, anchor: keyCentre(layout.rows[r].keys[c]) };
    }
    return clampPosition(layout, fallback);
  }

  /**
   * One d-pad step with wrap-around. Left/right wrap inside the row; up/down wrap across rows keeping the horizontal anchor.
   * @param {Layout} layout @param {Position} position @param {'up'|'down'|'left'|'right'} direction @returns {Position}
   */
  function move(layout, position, direction) {
    const current = clampPosition(layout, position);
    const row = layout.rows[current.row];
    if (direction === 'left' || direction === 'right') {
      const col = (current.col + (direction === 'right' ? 1 : -1) + row.keys.length) % row.keys.length;
      return { row: current.row, col, anchor: keyCentre(row.keys[col]) };
    }
    const anchor = Number.isFinite(position.anchor) ? position.anchor : current.anchor;
    const nextRow = (current.row + (direction === 'down' ? 1 : -1) + layout.rows.length) % layout.rows.length;
    return { row: nextRow, col: keyAt(layout.rows[nextRow], anchor), anchor };
  }

  /** @param {string} [initial] @returns {KeyboardState} */
  function createState(initial = '') {
    return { text: String(initial), layer: 'letters', shift: 'off' };
  }

  const isShifted = (state) => state.layer === 'letters' && state.shift !== 'off';

  /** Appends text, consuming a one-shot shift. */
  function insert(state, value) {
    return { ...state, text: state.text + value, shift: state.shift === 'once' ? 'off' : state.shift };
  }

  /** Removes the last code point (so emoji and surrogate pairs are not split). */
  function backspace(state) {
    return { ...state, text: Array.from(state.text).slice(0, -1).join('') };
  }

  /**
   * Applies a pressed key to the state.
   * @param {KeyboardState} state @param {Key} key
   * @returns {{ state: KeyboardState, submit: boolean }}
   */
  function press(state, key) {
    switch (key.kind) {
      case 'char':
      case 'space':
        return { state: insert(state, key.insert || ''), submit: false };
      case 'backspace':
        return { state: backspace(state), submit: false };
      case 'shift': {
        const shift = state.shift === 'off' ? 'once' : state.shift === 'once' ? 'lock' : 'off';
        return { state: { ...state, shift }, submit: false };
      }
      case 'layer':
        return { state: { ...state, layer: key.layer || 'letters', shift: key.layer === 'letters' ? state.shift : 'off' }, submit: false };
      case 'done':
        return { state, submit: true };
      default:
        return { state, submit: false };
    }
  }

  /** Types a character from a physical keyboard: keeps the model as the single source of truth. */
  function typeCharacter(state, character) {
    return { ...state, text: state.text + character };
  }

  /** The key a physical event maps to when it should move focus nowhere: a printable single character. */
  function isPrintable(event) {
    return typeof event.key === 'string' && Array.from(event.key).length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  }

  return { ROW_UNITS, buildLayout, clampPosition, locate, move, keyAt, createState, isShifted, insert, backspace, press, typeCharacter, isPrintable };
});
