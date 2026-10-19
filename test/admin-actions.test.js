'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, findAction } = require('../backend/actions');
const { createAdminRoutes } = require('../src/main/admin/routes');
const { createLogRing } = require('../src/main/admin/log');
const { buildStatus } = require('../src/main/admin/status');

test('ACTIONS lists the five admin actions with unique names', () => {
  const names = ACTIONS.map((action) => action.name);
  assert.deepEqual(names, ['reload-config', 'restart-soloist', 'clear-cache', 'pair-tv', 'restart-launcher']);
  assert.equal(new Set(names).size, names.length);
});

test('every action has a label, group and help text', () => {
  for (const action of ACTIONS) {
    assert.equal(typeof action.label, 'string', action.name);
    assert.ok(action.label.length > 0, action.name);
    assert.equal(typeof action.group, 'string', action.name);
    assert.ok(action.group.length > 0, action.name);
    assert.equal(typeof action.help, 'string', action.name);
    assert.ok(action.help.length > 0, action.name);
    assert.equal(typeof action.destructive, 'boolean', action.name);
  }
});

test('only restart-launcher is destructive', () => {
  const destructive = ACTIONS.filter((action) => action.destructive).map((action) => action.name);
  assert.deepEqual(destructive, ['restart-launcher']);
});

test('findAction returns the matching entry and null otherwise', () => {
  assert.equal(findAction('clear-cache').name, 'clear-cache');
  assert.equal(findAction('missing'), null);
  assert.equal(findAction('__proto__'), null);
  assert.equal(findAction('constructor'), null);
  assert.equal(findAction(undefined), null);
  assert.equal(findAction(42), null);
});

test('ACTIONS and its entries are frozen', () => {
  assert.equal(Object.isFrozen(ACTIONS), true);
  assert.equal(Object.isFrozen(ACTIONS[0]), true);
  assert.throws(() => { ACTIONS[0].destructive = true; }, TypeError);
});

test('status, log and diagnostics need a session and keep the fixture secret out of every response', async () => {
  const secret = 'fixture-vp-api-secret-987';
  const ring = createLogRing();
  ring.write('error', `Host rejected key ${secret}`);
  const routes = createAdminRoutes({
    getConfig: async () => ({ settings: { remote: { apiKey: secret, host: 'pc' } } }),
    saveConfig: async () => {},
    validate: () => {},
    auth: { verifySession: (token) => (token === 'good' ? { expiresAt: 1 } : null) },
    getStatus: () => buildStatus({ secretValues: [secret], host: () => ({ state: 'ok', detail: `host uses ${secret}` }) }),
    getLogTail: (count) => ring.tail(count),
    getSecretNames: () => ({ VP_API: secret, WEATHER_API: '' })
  });
  const dispatch = (input) => routes.dispatch({ address: '127.0.0.1', ...input });

  assert.equal((await dispatch({ method: 'GET', pathname: '/api/status', sessionToken: '' })).status, 401);
  assert.equal((await dispatch({ method: 'GET', pathname: '/api/diagnostics', sessionToken: '' })).status, 401);
  assert.equal((await dispatch({ method: 'POST', pathname: '/api/status', sessionToken: 'good' })).status, 405);

  const status = await dispatch({ method: 'GET', pathname: '/api/status', sessionToken: 'good' });
  assert.equal(status.status, 200);
  assert.equal(status.body.host.state, 'ok');

  const log = await dispatch({ method: 'GET', pathname: '/api/log', query: new URLSearchParams('tail=5'), sessionToken: 'good' });
  assert.equal(log.status, 200);
  assert.equal(log.body.entries.length, 1);

  const diagnostics = await dispatch({ method: 'GET', pathname: '/api/diagnostics', sessionToken: 'good' });
  assert.equal(diagnostics.status, 200);
  assert.equal(diagnostics.headers['Content-Disposition'], 'attachment; filename="hml-diagnostics.json"');
  assert.deepEqual(diagnostics.body.secretNames, [{ name: 'VP_API', set: true }, { name: 'WEATHER_API', set: false }]);
  assert.equal(JSON.stringify(diagnostics.body).includes(secret), false);
});
