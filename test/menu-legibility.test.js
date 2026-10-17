'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { contrastRatio } = require('../backend/builtin-themes');
const { vpnSubtitle, shortenMiddle } = require('../src/renderer/status-widgets');
const { buildGpuSwitches } = require('../src/main/gpu-flags');

const renderer = (file) => fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8');
const menuCss = renderer('menu.css');
const themeCss = renderer('theme.css');

const panelBlock = /#system-panel\.menu-panel \{[^}]*\}/.exec(menuCss)[0];
const token = (name) => {
  const match = new RegExp(`--${name}:\s*([^;]+);`).exec(panelBlock);
  assert.ok(match, `--${name} must be defined on the panel`);
  return match[1].trim();
};
const hexChannels = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const toHex = (channels) => `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
/** sRGB blend of `amount` of `b` into `a`, matching CSS color-mix(in srgb). */
const mix = (a, b, amount) => toHex(hexChannels(a).map((value, index) => value + (hexChannels(b)[index] - value) * amount));
/** `foreground` at `alpha` over an opaque `background`. */
const over = (foreground, alpha, background) => mix(background, foreground, alpha);

const base = token('panel-base');
const lensMix = parseFloat(token('panel-lens-mix')) / 100;
const [surfaceR, surfaceG, surfaceB, surfaceAlpha] = /rgb\(([\d.]+) ([\d.]+) ([\d.]+) \/ ([\d.]+)\)/.exec(token('panel-surface')).slice(1).map(Number);
// Worst case: the near-opaque surface over a pure white wallpaper pixel.
const surface = over(toHex([surfaceR, surfaceG, surfaceB]), surfaceAlpha, '#ffffff');
const mutedAlpha = Number(/rgb\([\d ]+\/ ([\d.]+)\)/.exec(token('menu-text-muted'))[1]);
const unique = (name) => [...new Set([...themeCss.matchAll(new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6})`, 'g'))].map((m) => m[1].toLowerCase()))];
const { PALETTES } = require('../src/renderer/theme');
const accents = [...new Set([...unique('accent'), ...PALETTES.map((palette) => palette.accent.toLowerCase())])];
const dangers = unique('danger');
const AA = 4.5;

test('theme.css exposes accent and danger tokens to check', () => {
  assert.ok(accents.length >= 8);
  assert.ok(dangers.length >= 2);
});

test('panel text and caption meet WCAG AA on the glass surface', () => {
  assert.ok(contrastRatio('#ffffff', surface) >= 7, 'primary text');
  assert.ok(contrastRatio(over('#e2e7f5', mutedAlpha, surface), surface) >= AA, 'caption text');
});

test('focused row keeps readable primary and secondary text for every accent', () => {
  for (const accent of accents) {
    const lens = mix(base, accent, lensMix);
    assert.ok(contrastRatio('#ffffff', lens) >= AA, `white on lens for accent ${accent}`);
  }
  for (const danger of dangers) {
    const lens = mix(base, danger, lensMix);
    assert.ok(contrastRatio('#ffffff', lens) >= AA, `white on danger lens for ${danger}`);
    assert.ok(contrastRatio(mix(danger, '#ffffff', 0.45), surface) >= AA, `unfocused danger text for ${danger}`);
  }
});

test('disabled rows stay above AA', () => {
  const opacity = Number(/\[data-state="unavailable"\] \{ opacity: ([\d.]+)/.exec(renderer('status.css'))[1]);
  const muted = over('#e2e7f5', mutedAlpha, surface);
  assert.ok(contrastRatio(over(muted, opacity, surface), surface) >= AA);
  assert.ok(contrastRatio(over('#ffffff', opacity, surface), surface) >= AA);
});

test('10-foot type sizes: body at least 17px, caption at least 14px', () => {
  assert.match(menuCss, /\.menu-copy strong \{ font: 600 18px/);
  assert.match(menuCss, /\.menu-copy small \{[^}]*font: 450 14px/);
});

test('the sheet has no backdrop blur and is a contained, promoted layer', () => {
  const block = panelBlock;
  assert.match(block, /backdrop-filter: none/);
  assert.match(block, /contain: layout paint/);
  assert.match(block, /will-change: transform, opacity/);
});

test('vpnSubtitle explains every state and never truncates silently', () => {
  assert.equal(vpnSubtitle({ available: true, connected: false }), 'Off');
  assert.equal(vpnSubtitle({ available: true, busy: true }), 'Working\u2026');
  assert.equal(vpnSubtitle({ available: false }), 'Not available on this PC');
  assert.equal(vpnSubtitle({ available: true, connected: true }), 'Connected');
  assert.equal(vpnSubtitle({ available: true, connected: true, detail: 'DESKTOP-PK9MP2U \u00b7 100.101.102.103' }), 'Connected \u00b7 DESKTOP-PK9MP2U \u00b7 100.101.102.103');
  const long = vpnSubtitle({ available: true, connected: true, detail: `${'h'.repeat(40)} \u00b7 100.64.0.1` });
  assert.ok(long.endsWith('\u00b7 100.64.0.1') && long.includes('\u2026'));
  assert.ok(vpnSubtitle({ available: false, error: 'Not supported here. Use the app.' }).startsWith('Not supported here'));
  assert.equal(shortenMiddle('short'), 'short');
});

test('Windows uses software compositing by default; in-process GPU is opt-in (it presents grey in fullscreen)', () => {
  const names = (env) => buildGpuSwitches('win32', env).switches.map(([name]) => name);
  assert.ok(names({}).includes('disable-gpu-compositing'));
  assert.ok(!names({}).includes('in-process-gpu'));
  assert.ok(names({ HML_GPU_PROCESS: 'inprocess' }).includes('in-process-gpu'));
  assert.ok(!names({ HML_GPU_COMPOSITING: 'gpu' }).includes('disable-gpu-compositing'));
  assert.ok(!buildGpuSwitches('linux', {}).switches.some(([name]) => name === 'disable-gpu-compositing'));
});
