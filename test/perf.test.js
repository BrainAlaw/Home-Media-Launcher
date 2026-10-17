'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Perf = require('../src/renderer/perf');
const { validateConfig } = require('../src/main/config');
const { buildGpuSwitches } = require('../src/main/gpu-flags');

test('normalizeMode and resolveLite', () => {
  assert.equal(Perf.normalizeMode('bogus'), 'auto');
  assert.equal(Perf.resolveLite('lite', false), true);
  assert.equal(Perf.resolveLite('quality', true), false);
  assert.equal(Perf.resolveLite('auto', true), true);
  assert.equal(Perf.resolveLite('auto', false), false);
});

test('FrameMeter ignores idle gaps and counts long frames', () => {
  const meter = new Perf.FrameMeter();
  [0, 16, 32, 100, 116, 1000, 1016].forEach((t) => meter.tick(t));
  const s = meter.snapshot();
  assert.equal(s.frames, 5);
  assert.equal(s.longFrames, 1);
  assert.equal(Math.round(s.worstMs), 68);
});

test('governor latches lite after a slow 5 s window only', () => {
  const fast = Perf.createGovernor();
  for (let i = 0; i < 400; i += 1) fast.push(16.7);
  assert.equal(fast.lite, false);
  const slow = Perf.createGovernor();
  for (let i = 0; i < 160; i += 1) slow.push(40);
  assert.equal(slow.lite, true);
  slow.push(16);
  assert.equal(slow.lite, true);
});

test('governor needs enough frames in a window', () => {
  const g = Perf.createGovernor();
  for (let i = 0; i < 20; i += 1) g.push(260);
  assert.equal(g.lite, false);
});

test('springEasing produces a linear() easing ending at 1', () => {
  const { easing, durationMs } = Perf.springEasing({ stiffness: 360, damping: 32 });
  assert.match(easing, /^linear\(0, /);
  assert.match(easing, /, 1\)$/);
  assert.ok(durationMs > 100 && durationMs < 1000);
  assert.throws(() => Perf.springEasing({ stiffness: -1 }));
});

test('config validates settings.performance', () => {
  for (const value of ['auto', 'quality', 'lite']) assert.ok(validateConfig({ rows: [], settings: { performance: value } }));
  assert.throws(() => validateConfig({ rows: [], settings: { performance: 'turbo' } }), /performance/);
});

test('buildGpuSwitches targets platform and honours the safe-mode opt-out', () => {
  const linux = buildGpuSwitches('linux', {});
  assert.ok(linux.switches.some(([name]) => name === 'enable-zero-copy'));
  assert.ok(linux.features.includes('VaapiVideoDecoder'));
  const win = buildGpuSwitches('win32', {});
  assert.ok(!win.features.includes('VaapiVideoDecoder'));
  assert.ok(win.switches.some(([name]) => name === 'enable-gpu-rasterization'));
  assert.deepEqual(buildGpuSwitches('linux', { HML_GPU_SAFE: '1' }), { switches: [], features: [] });
});
