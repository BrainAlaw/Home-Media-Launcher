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

function actionRoutes(actions) {
  return createAdminRoutes({
    getConfig: async () => ({ settings: {} }),
    saveConfig: async () => {},
    validate: () => {},
    auth: { verifySession: (token) => (token === 'good' ? { expiresAt: 1 } : null) },
    actions
  });
}

test('confirmation tokens are issued only for destructive actions and need a session', async () => {
  const routes = actionRoutes({});
  const get = (pathname, sessionToken = 'good') => routes.dispatch({ method: 'GET', pathname, sessionToken, address: '127.0.0.1' });

  assert.equal((await get('/api/actions/confirm/restart-launcher', '')).status, 401);
  assert.equal((await get('/api/actions/confirm/reload-config')).status, 404);
  assert.equal((await get('/api/actions/confirm/missing')).status, 404);
  assert.equal((await get('/api/actions/confirm/restart-launcher/extra')).status, 404);
  assert.equal((await routes.dispatch({ method: 'POST', pathname: '/api/actions/confirm/restart-launcher', sessionToken: 'good', address: '127.0.0.1' })).status, 405);

  const issued = await get('/api/actions/confirm/restart-launcher');
  assert.equal(issued.status, 200);
  assert.equal(issued.body.token.length, 6);
  assert.equal(typeof issued.body.expiresAt, 'number');
});

test('destructive actions run only after a single-use confirmation token is consumed', async () => {
  const calls = [];
  const routes = actionRoutes({
    'restart-launcher': () => { calls.push('restart-launcher'); return 'Restarting.'; },
    'reload-config': () => { calls.push('reload-config'); }
  });
  const dispatch = (input) => routes.dispatch({ sessionToken: 'good', address: '127.0.0.1', ...input });
  const issued = await dispatch({ method: 'GET', pathname: '/api/actions/confirm/restart-launcher' });

  assert.equal((await dispatch({ method: 'POST', pathname: '/api/actions/restart-launcher', body: {} })).status, 428);
  assert.equal((await dispatch({ method: 'POST', pathname: '/api/actions/restart-launcher', body: { confirm: '' } })).status, 428);
  assert.equal((await dispatch({ method: 'POST', pathname: '/api/actions/restart-launcher', body: { confirm: 'WRONG123' } })).status, 403);
  assert.deepEqual(calls, []);

  const run = await dispatch({ method: 'POST', pathname: '/api/actions/restart-launcher', body: { confirm: issued.body.token } });
  assert.equal(run.status, 200);
  assert.deepEqual(run.body, { ok: true, message: 'Restarting.' });
  assert.equal((await dispatch({ method: 'POST', pathname: '/api/actions/restart-launcher', body: { confirm: issued.body.token } })).status, 403);
  assert.deepEqual(calls, ['restart-launcher']);
});

test('non-destructive actions run their handler, answer 503 without one and 404 for unknown names', async () => {
  const routes = actionRoutes({
    'clear-cache': () => 'Cleared 12 files.',
    'restart-soloist': () => { throw new Error('C:/private/path leaked'); }
  });
  const post = (pathname, sessionToken = 'good') => routes.dispatch({ method: 'POST', pathname, sessionToken, body: {}, address: '127.0.0.1' });

  assert.equal((await post('/api/actions/clear-cache', '')).status, 401);
  assert.equal((await post('/api/actions/missing')).status, 404);
  assert.equal((await post('/api/actions/confirm')).status, 404);
  assert.equal((await routes.dispatch({ method: 'GET', pathname: '/api/actions/clear-cache', sessionToken: 'good', address: '127.0.0.1' })).status, 405);
  assert.equal((await post('/api/actions/pair-tv')).status, 503);

  const cleared = await post('/api/actions/clear-cache');
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body, { ok: true, message: 'Cleared 12 files.' });

  const failed = await post('/api/actions/restart-soloist');
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: 'Action failed' });
});
