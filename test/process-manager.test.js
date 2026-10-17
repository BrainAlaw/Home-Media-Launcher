'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ProcessManager } = require('../src/main/process-manager');

test('spawns argv without shell by default and emits lifecycle events', async () => {
  const child = new EventEmitter();
  child.pid = 42;
  let invocation;
  const manager = new ProcessManager((...args) => { invocation = args; return child; });
  const finished = new Promise((resolve) => manager.once('finished', resolve));
  assert.deepEqual(manager.launch({ id: 'one', command: 'app', args: ['--safe'] }), { pid: 42 });
  assert.equal(invocation[2].shell, false);
  assert.throws(() => manager.launch({ id: 'two', command: 'other' }), /already running/);
  child.emit('exit', 0, null);
  assert.deepEqual(await finished, { code: 0, signal: null, tileId: 'one' });
  assert.equal(manager.active, null);
});
