'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLaunchConfig, createLaunchSession } = require('../src/renderer/launch-session');

const game = (id, extra = {}) => ({ id, name: id.toUpperCase(), ...extra });

test('launch config maps tile kinds', () => {
  assert.equal(buildLaunchConfig(game('w', { type: 'website', url: 'https://x.test' })).kind, 'website');
  assert.equal(buildLaunchConfig(game('r', { provider: 'remote' })).kind, 'stream');
  assert.deepEqual(buildLaunchConfig(game('n', { command: 'app', args: ['-f'] })),
    { appId: 'n', kind: 'native', fullscreen: true, command: 'app', args: ['-f'] });
});

function harness(overrides = {}) {
  const handlers = {};
  const log = [];
  const api = {
    launchApp: async (config) => { log.push(['launch', config.appId]); return { appId: config.appId, pid: 1 }; },
    onAppLaunched: (cb) => { handlers.launched = cb; return () => {}; },
    onAppClosed: (cb) => { handlers.closed = cb; return () => {}; },
    ...overrides
  };
  const session = createLaunchSession({
    api, onSuspend: (id) => log.push(['suspend', id]), onResume: (event) => log.push(['resume', event.appId])
  });
  return { session, handlers, log };
}

test('session suspends on launch and resumes once on close', async () => {
  const { session, handlers, log } = harness();
  assert.equal(await session.launch(game('a')), true);
  assert.equal(await session.launch(game('b')), false);
  handlers.closed({ appId: 'a' });
  handlers.closed({ appId: 'a' });
  assert.deepEqual(log, [['launch', 'a'], ['suspend', 'a'], ['resume', 'a']]);
  assert.equal(session.phase, 'idle');
});

test('exit before launchApp resolves does not re-suspend', async () => {
  const handlers = {};
  const log = [];
  const session = createLaunchSession({
    api: {
      launchApp: async (config) => { handlers.closed({ appId: config.appId }); return { appId: config.appId, pid: null }; },
      onAppLaunched: () => () => {}, onAppClosed: (cb) => { handlers.closed = cb; return () => {}; }
    },
    onSuspend: () => log.push('suspend'), onResume: () => log.push('resume')
  });
  await session.launch(game('a'));
  assert.deepEqual(log, ['resume']);
  assert.equal(session.phase, 'idle');
});

test('rejected launch returns to idle; missing handler falls back to legacy launch', async () => {
  const failing = harness({ launchApp: async () => { throw new Error('boom'); } });
  await assert.rejects(failing.session.launch(game('a')), /boom/);
  assert.equal(failing.session.phase, 'idle');

  const calls = [];
  const session = createLaunchSession({
    api: { launchApp: async () => { throw new Error("No handler registered for 'launcher:launch-app'"); }, onAppLaunched: () => () => {}, onAppClosed: () => () => {} },
    legacyLaunch: async (id) => { calls.push(id); },
    onSuspend: () => calls.push('suspend'), onResume: () => {}
  });
  assert.equal(await session.launch(game('a')), true);
  assert.deepEqual(calls, ['a', 'suspend']);
});
