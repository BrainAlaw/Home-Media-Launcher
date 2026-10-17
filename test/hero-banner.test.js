'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHeroMeta, formatPlaytime, createDebouncer, DEBOUNCE_MS } = require('../src/renderer/hero-banner');

test('playtime formats minutes for a 10-foot UI', () => {
  assert.equal(formatPlaytime(null), '');
  assert.equal(formatPlaytime(0), 'Not played yet');
  assert.equal(formatPlaytime(42), '42 min played');
  assert.equal(formatPlaytime(60), '1 h played');
  assert.equal(formatPlaytime(135), '2 h 15 min played');
  assert.equal(formatPlaytime(6030), '100 h played');
  assert.equal(formatPlaytime(-5), '');
});

test('hero metadata accepts backend aliases and flags the offline state', () => {
  const meta = normalizeHeroMeta({
    id: 'g1', name: ' Hades ', clear_logo: 'logo.png', summary: 'Escape the underworld.', playtime: 7200, isVibepolloOffline: true
  }, { recent: true, subtitle: 'Moonlight' });
  assert.deepEqual(
    [meta.title, meta.logo, meta.description, meta.playtime, meta.kicker, meta.offline, meta.cta],
    ['Hades', 'logo.png', 'Escape the underworld.', '2 h played', 'Continue', true, 'Play']
  );
  const web = normalizeHeroMeta({ id: 'w', name: 'Site', type: 'website', playtimeMinutes: 5, isVibepolloOffline: 'yes' });
  assert.equal(web.cta, 'Open');
  assert.equal(web.offline, false);
  assert.equal(web.playtime, '5 min played');
  assert.notEqual(web.key, normalizeHeroMeta({ id: 'w', name: 'Site', type: 'website' }).key);
  assert.equal(normalizeHeroMeta({ id: 'w', name: 'Site' }).key, normalizeHeroMeta({ id: 'w', name: 'Site' }).key);
});

test('debouncer coalesces rapid updates into one trailing call', () => {
  const timers = []; const calls = [];
  const fire = () => timers.filter((timer) => timer.live).forEach((timer) => { timer.live = false; timer.fn(); });
  const debouncer = createDebouncer((value) => calls.push(value), DEBOUNCE_MS, {
    set: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; },
    clear: (handle) => { timers[handle].live = false; }
  });
  debouncer.schedule('a'); debouncer.schedule('b'); debouncer.schedule('c');
  assert.equal(debouncer.pending, true);
  fire();
  assert.deepEqual(calls, ['c']);
  assert.equal(debouncer.pending, false);
  assert.equal(timers[0].ms, 150);
  debouncer.schedule('d'); debouncer.cancel();
  fire();
  assert.deepEqual(calls, ['c']);
});

test('hero styles stay token-driven and animate compositor properties only', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/hero.css'), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b(?![^{]*\{)/i);
  assert.doesNotMatch(css, /transition:\s*(?:all|width|height|top|left)/);
  assert.match(css, /var\(--warn\)/);
});
