'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivityGate, createGatedPoller } = require('../src/main/activity');

/** Minimal fake interval clock: `tick()` fires every armed interval once. */
function fakeClock() {
  let next = 1;
  const active = new Map();
  return {
    setIntervalFn: (fn) => { const id = { id: next++, unref() {} }; active.set(id, fn); return id; },
    clearIntervalFn: (id) => { active.delete(id); },
    tick: () => { for (const fn of [...active.values()]) fn(); },
    get armed() { return active.size; }
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('gate follows session phases', () => {
  const gate = createActivityGate();
  const seen = [];
  gate.onChange((value) => seen.push(value));
  gate.setPhase('launching'); gate.setPhase({ phase: 'running' }); gate.setPhase('closing');
  assert.equal(gate.suspended, true);
  gate.setPhase('idle'); gate.setPhase('idle');
  assert.deepEqual(seen, [true, false]);
});

test('poller runs no task while suspended and refreshes exactly once on resume', async () => {
  const gate = createActivityGate();
  const clock = fakeClock();
  let calls = 0;
  const poller = createGatedPoller({ gate, intervalMs: 10, task: () => { calls++; }, ...clock });
  poller.start();
  await flush();
  assert.equal(calls, 1);
  clock.tick(); await flush();
  assert.equal(calls, 2);

  gate.setPhase('running');
  assert.equal(clock.armed, 0, 'timer removed while suspended');
  clock.tick(); clock.tick(); await flush();
  assert.equal(calls, 2, 'no polls while suspended');

  gate.setPhase('idle'); await flush();
  assert.equal(calls, 3, 'one immediate refresh on resume');
  assert.equal(clock.armed, 1);
  poller.stop();
  assert.equal(clock.armed, 0);
});

test('poller never overlaps polls and aborts the in-flight one on suspend', async () => {
  const gate = createActivityGate();
  const clock = fakeClock();
  const signals = [];
  const releases = [];
  const poller = createGatedPoller({ gate, intervalMs: 10, ...clock, task: (signal) => { signals.push(signal); return new Promise((resolve) => releases.push(resolve)); } });
  poller.start(); await flush();
  clock.tick(); clock.tick(); await flush();
  assert.equal(signals.length, 1, 'ticks during an in-flight poll are ignored');

  gate.setPhase('running');
  assert.equal(signals[0].aborted, true);
  gate.setPhase('idle'); await flush();
  assert.equal(signals.length, 2, 'resume starts a fresh poll even though the old probe never returned');
  assert.equal(signals[1].aborted, false);
  releases.forEach((release) => release());
  poller.stop();
});

test('refreshNow (user triggered) is not blocked by the gate', async () => {
  const gate = createActivityGate();
  gate.setPhase('running');
  let calls = 0;
  const poller = createGatedPoller({ gate, intervalMs: 10, task: () => { calls++; }, ...fakeClock() });
  poller.start(); await flush();
  assert.equal(calls, 0);
  await poller.refreshNow();
  assert.equal(calls, 1);
  poller.stop();
});
