'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Credit = require('../src/renderer/wallpaper-credit');

class FakeElement {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ''; this.hidden = false; this.classes = new Set(); this.classList = { add: (name) => this.classes.add(name), remove: (name) => this.classes.delete(name), contains: (name) => this.classes.has(name) }; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
}

function harness({ holdMs = 8000 } = {}) {
  global.document = { createElement: (tag) => new FakeElement(tag) };
  const timers = [];
  const root = new FakeElement();
  const overlay = Credit.createOverlay({
    root, holdMs,
    setTimer: (callback, delay) => { timers.push({ callback, delay, cancelled: false }); return timers.length - 1; },
    clearTimer: (id) => { if (id !== null && timers[id]) timers[id].cancelled = true; }
  });
  const fire = () => { const live = timers.filter((timer) => !timer.cancelled); live.forEach((timer) => { timer.cancelled = true; timer.callback(); }); };
  return { root, overlay, timers, fire, texts: () => root.children.map((child) => child.textContent) };
}

test('sourceLabel names known hosts and falls back to the host or the text', () => {
  assert.equal(Credit.sourceLabel('https://commons.wikimedia.org/wiki/File:A.jpg'), 'Wikimedia Commons');
  assert.equal(Credit.sourceLabel('https://www.example.org/x'), 'example.org');
  assert.equal(Credit.sourceLabel('Photographer archive'), 'Photographer archive');
  assert.equal(Credit.sourceLabel(''), '');
  assert.equal(Credit.sourceLabel(undefined), '');
});

test('creditLines keeps only the image title and author visible', () => {
  assert.deepEqual(Credit.creditLines({ title: 'Misty Alps', location: 'Switzerland', author: 'Ann', license: 'CC0', source: 'https://commons.wikimedia.org/wiki/File:A.jpg' }),
    { title: 'Misty Alps', byline: 'Ann', via: '', key: 'Misty Alps|Ann|CC0|Wikimedia Commons' });
  assert.equal(Credit.creditLines({ title: 'Lake Bled', location: 'bled' }).title, 'Lake Bled');
  assert.equal(Credit.creditLines({ author: 'Ann' }).byline, 'Ann');
  assert.equal(Credit.creditLines({ license: 'CC0' }), null);
  assert.equal(Credit.creditLines(null), null);
  assert.equal(Credit.creditLines({}), null);
});

test('fromBundled maps gallery entries', () => {
  assert.deepEqual(Credit.fromBundled({ name: 'Lofoten', author: 'Johannes', license: 'CC0', source: 'https://commons.wikimedia.org/x' }),
    { title: 'Lofoten', author: 'Johannes', license: 'CC0', source: 'https://commons.wikimedia.org/x', location: '', origin: 'bundled' });
  assert.equal(Credit.fromBundled(null), null);
});

test('overlay fades in on change, out after the hold time and stays quiet for repeats', () => {
  const { overlay, timers, fire, texts, root } = harness();
  const credit = { title: 'Lofoten', author: 'Johannes', license: 'CC0', source: 'https://commons.wikimedia.org/x' };
  assert.equal(root.attributes['aria-hidden'], 'true');
  overlay.show(credit);
  assert.equal(overlay.visible, true);
  assert.deepEqual(texts(), ['Lofoten', 'Johannes', '']);
  assert.equal(timers[0].delay, 8000);
  overlay.show(credit);
  assert.equal(timers.length, 1);
  fire();
  assert.equal(overlay.visible, false);
  overlay.show({ ...credit, title: 'Next' });
  assert.equal(overlay.visible, true);
  assert.equal(texts()[0], 'Next');
});

test('overlay hides for credit-less backdrops, re-announces afterwards and respects the setting', () => {
  const { overlay } = harness();
  const credit = { title: 'A', author: 'B' };
  overlay.show(credit);
  overlay.show(null);
  assert.equal(overlay.visible, false);
  overlay.show(credit);
  assert.equal(overlay.visible, true);
  overlay.setEnabled(false);
  assert.equal(overlay.visible, false);
  overlay.show({ title: 'C' });
  assert.equal(overlay.visible, false);
  overlay.setEnabled(true);
  overlay.show({ title: 'D' });
  assert.equal(overlay.visible, true);
});
