'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SpringValue, MotionScheduler, CompositorScheduler } = require('../src/renderer/menu-motion');

test('springs settle consistently at 60 and 120 Hz without losing velocity on retarget', () => {
  const simulate = (hz) => {
    const spring = new SpringValue(0);
    spring.target = 100;
    for (let frame = 0; frame < hz; frame++) spring.step(1 / hz);
    assert.equal(spring.value, 100);
    assert.equal(spring.velocity, 0);
    return spring;
  };
  simulate(60); simulate(120);
  const spring = new SpringValue(); spring.target = 1;
  spring.step(1 / 60);
  const velocity = spring.velocity;
  spring.target = -1;
  assert.equal(spring.velocity, velocity);
  for (let frame = 0; frame < 120; frame++) spring.step(1 / 120);
  assert.equal(spring.value, -1);
  spring.target = 3; spring.step(1);
  assert.equal(spring.value, 3);
  assert.throws(() => new SpringValue(0, { mass: 0 }), /Invalid/);
});

test('callback scheduler remains compatible with controller screens and cancels reduced motion work', () => {
  let callback; let cancelled = null; let value;
  const scheduler = new MotionScheduler({ requestFrame: (next) => { callback = next; return 7; }, cancelFrame: (id) => { cancelled = id; } });
  const motion = scheduler.create({ x: 0 }, (state) => { value = state.x; });
  motion.to({ x: 100 }); callback(0);
  assert.ok(value > 0 && value < 100);
  scheduler.setReducedMotion(true);
  assert.equal(value, 100);
  assert.equal(cancelled, 7);
  assert.equal(scheduler.motions.size, 0);
  motion.to({ x: -20 });
  assert.equal(value, -20);
  scheduler.dispose();
});

test('compositor springs preserve momentum, cancel stale completions and snap for reduced motion', () => {
  const effects = [];
  const element = { style: {}, animate: (keyframes, options) => {
    const effect = { keyframes, options, currentTime: 0, cancelled: false, cancel() { this.cancelled = true; }, onfinish: null };
    effects.push(effect); return effect;
  } };
  const scheduler = new CompositorScheduler();
  const motion = scheduler.create({ x: 0 }, [{ element, style: (value) => ({ transform: `translateX(${value.x}px)` }) }]);
  motion.to({ x: 100 });
  const first = effects[0];
  first.currentTime = 60;
  motion.to({ x: -100 });
  const reversed = effects[1];
  assert.equal(first.cancelled, true);
  assert.ok(motion.springs.x.value > 0 && motion.springs.x.value < 100);
  assert.ok(motion.springs.x.velocity > 0, 'Retargeting must preserve the incoming velocity');
  assert.ok(reversed.keyframes.length > 10, 'Compositor keyframes must represent the physical trajectory');
  first.onfinish();
  assert.equal(reversed.cancelled, false, 'A stale completion cannot cancel the new spring');
  reversed.onfinish();
  assert.equal(element.style.transform, 'translateX(-100px)');
  assert.equal(scheduler.motions.size, 0);
  motion.to({ x: 25 }); scheduler.setReducedMotion(true);
  assert.equal(element.style.transform, 'translateX(25px)');
  assert.equal(scheduler.motions.size, 0);
  const count = effects.length;
  motion.to({ x: 5 }, { x: 500 });
  assert.equal(effects.length, count);
  assert.equal(element.style.transform, 'translateX(5px)');
  scheduler.dispose();
});

test('the top navigation bar and its focus lens are gone from markup and styles', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/menu.css'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '../src/renderer/navigation-menu.js'), 'utf8');
  assert.doesNotMatch(html, /primary-navigation/);
  assert.doesNotMatch(css, /primary-navigation|navigation-lens|navigation-tab/);
  assert.doesNotMatch(script, /navigation-tab|navigation-lens|matchesCategory/);
});

test('menu materials and spring transforms do not override game tile or hero selectors', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/menu.css'), 'utf8');
  assert.doesNotMatch(css, /(?:^|[\s,])\.(?:tile|hero|art|track|row)(?:\s|[.:{])/m);
  assert.ok([...css.matchAll(/transition\s*:\s*([^;]+);/g)].every((match) => match[1].trim() === 'none'));
  assert.match(css, /backdrop-filter: blur/);
  assert.match(css, /prefers-reduced-motion/);
});
