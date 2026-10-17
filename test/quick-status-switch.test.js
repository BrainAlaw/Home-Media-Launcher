'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { vpnChipView, hostChipView } = require('../src/renderer/status-widgets');
const HomeSections = require('../src/renderer/home-sections');
const MenuSwitch = require('../src/renderer/menu-switch');

const renderer = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', name), 'utf8');

test('VPN chips: hidden only when unavailable and not configured', () => {
  assert.equal(vpnChipView(undefined).hidden, true);
  assert.equal(vpnChipView({ label: 'Surfshark', available: false }).hidden, true);
  assert.equal(vpnChipView({ label: 'Tailscale', available: false, error: 'Tailscale is not installed.' }).hidden, true);
  const broken = vpnChipView({ label: 'Surfshark', available: false, error: 'Connection profile rejected the credentials' });
  assert.deepEqual([broken.hidden, broken.tone], [false, 'idle']);
});

test('VPN chips: connected is on, disconnected is off, busy pulses', () => {
  assert.equal(vpnChipView({ label: 'Tailscale', available: true, connected: true }).tone, 'on');
  assert.equal(vpnChipView({ label: 'Tailscale', available: true, connected: false }).tone, 'off');
  const busy = vpnChipView({ label: 'Surfshark', available: true, connected: false, busy: true });
  assert.equal(busy.tone, 'busy');
  assert.match(busy.label, /Surfshark/);
});

test('host chip maps status to tone and hides when disabled', () => {
  const tone = (status) => hostChipView({ hostname: 'MK-PC', ip: '10.0.0.2', status }, HomeSections);
  assert.equal(tone('online').tone, 'on');
  assert.equal(tone('offline').tone, 'off');
  assert.equal(tone('cached').tone, 'warn');
  assert.equal(tone('disabled').hidden, true);
  assert.match(tone('online').label, /MK-PC.*Online/);
});

test('Gaming host badge builder is gone', () => {
  assert.equal(HomeSections.createHostBadge, undefined);
  assert.ok(!/host-badge|hostBadge/.test(renderer('app.js')));
});

test('switch helpers keep ARIA state and busy flag in sync', () => {
  const attributes = new Map();
  const element = { dataset: {}, setAttribute: (k, v) => attributes.set(k, v), getAttribute: (k) => attributes.get(k) ?? null };
  MenuSwitch.setSwitch(element, true, { busy: true });
  assert.equal(MenuSwitch.isOn(element), true);
  assert.equal(element.dataset.busy, 'true');
  MenuSwitch.setSwitch(element, false);
  assert.equal(MenuSwitch.isOn(element), false);
  assert.equal(element.dataset.busy, undefined);
});

test('switch rows are role=switch buttons with a fixed trailing track', () => {
  const html = renderer('index.html');
  assert.match(html, /id="autostart"[^>]*role="switch"[^>]*aria-checked="false"/);
  assert.ok(!/type="checkbox"/.test(html.slice(html.indexOf('id="system-panel"'), html.indexOf('<dialog id="settings-dialog"'))));
  const css = renderer('menu.css');
  assert.match(css, /--sw-w: max\(44px, calc\(56 \* var\(--hig-px/);
  assert.match(css, /--sw-h: calc\(var\(--sw-w\) \* 32 \/ 56\)/);
  assert.match(css, /\.menu-action\.menu-toggle \{[^}]*height: 80px/);
  const knob = /\.switch-knob \{[^}]*\}/.exec(css)[0];
  assert.match(knob, /transition: transform/);
});

test('system button has one coherent state model', () => {
  const menu = renderer('menu.css');
  assert.match(menu, /#system-button\.icon-button\[aria-expanded="true"\] \{[^}]*scale\(1\.18\)/);
  assert.match(menu, /#system-button\.icon-button:is\(:focus, \.focused\) \{[^}]*scale\(1\.12\)/);
  assert.match(menu, /#system-button\[aria-expanded="true"\] svg \{ transform: rotate\(90deg\)/);
  const block = menu.slice(menu.indexOf('#system-button.icon-button {'), menu.indexOf('Quick-settings sheet'));
  assert.ok(!/backdrop-filter:\s*blur/.test(block));
  assert.ok(!/transition:[^;]*(all|width|height|margin|padding)/.test(block));
  // No other stylesheet may restyle the button's colour states.
  for (const name of ['perf.css', 'status.css']) assert.ok(!/#system-button/.test(renderer(name)), name);
  assert.ok(!/systemMotion/.test(renderer('navigation-menu.js')));
});

test('quick settings sheet is fully opaque', () => {
  assert.match(renderer('menu.css'), /--panel-surface: rgb\(23 27 38 \/ 1\)/);
});
