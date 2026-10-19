'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminAuth } = require('../src/main/admin/auth');
const { createAdminRoutes, redactConfig, SESSION_COOKIE } = require('../src/main/admin/routes');

function setup() {
  let now = 1000;
  const auth = createAdminAuth({ now: () => now, randomInt: () => 7, randomBytes: (size) => Buffer.alloc(size, 3) });
  const counters = { saved: 0, validated: 0 };
  let current = { settings: { title: 'Living room' } };
  const routes = createAdminRoutes({
    auth,
    getConfig: () => current,
    validate: (config) => { counters.validated += 1; if (config.invalid) throw new Error('invalid fixture'); },
    saveConfig: (config) => { counters.saved += 1; current = config; },
    appVersion: '9.8.7'
  });
  const pairing = auth.createPairCode();
  const pair = async () => {
    const result = await routes.dispatch({ method: 'POST', pathname: '/api/pair', body: { code: pairing.code }, address: '127.0.0.1' });
    const cookie = result.headers['Set-Cookie'];
    const token = cookie.split(';')[0].slice(`${SESSION_COOKIE}=`.length);
    return { result, token };
  };
  return { routes, auth, counters, pair, current: () => current, advance: (ms) => { now += ms; } };
}

test('redacts secret-looking keys recursively without changing the input', () => {
  const config = {
    apiToken: 'abc',
    nested: { publicKey: 'key-value', clientSecret: '', PasswordHint: null, label: 'safe' },
    rows: [{ access_token: 'token' }]
  };
  assert.deepEqual(redactConfig(config), {
    apiToken: '<set>',
    nested: { publicKey: '<set>', clientSecret: '<unset>', PasswordHint: '<unset>', label: 'safe' },
    rows: [{ access_token: '<set>' }]
  });
  assert.equal(config.apiToken, 'abc');
});

test('GET health and session are public; unknown routes and wrong methods are explicit', async () => {
  const { routes } = setup();
  assert.deepEqual(await routes.dispatch({ method: 'GET', pathname: '/api/health' }), { status: 200, body: { ok: true, version: '9.8.7' }, headers: {} });
  assert.equal((await routes.dispatch({ method: 'GET', pathname: '/api/session' })).body.authenticated, false);
  assert.equal((await routes.dispatch({ method: 'GET', pathname: '/api/nope' })).status, 404);
  assert.deepEqual(await routes.dispatch({ method: 'POST', pathname: '/api/health' }), { status: 405, body: { error: 'Method not allowed' }, headers: { Allow: 'GET' } });
});

test('PUT validates before save and never saves invalid configuration', async () => {
  const { routes, auth, counters, pair } = setup();
  const { token } = await pair();
  const invalid = await routes.dispatch({ method: 'PUT', pathname: '/api/config', sessionToken: token, body: { invalid: true } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error, 'invalid fixture');
  assert.equal(counters.validated, 1);
  assert.equal(counters.saved, 0);
  const valid = await routes.dispatch({ method: 'PUT', pathname: '/api/config', sessionToken: token, body: { settings: { title: 'Updated' } } });
  assert.equal(valid.status, 200);
  assert.equal(counters.saved, 1);
  assert.equal(auth.sessionStatus(token).authenticated, true);
});

test('pair returns secure cookie and config requires authenticated session', async () => {
  const { routes, pair } = setup();
  assert.equal((await routes.dispatch({ method: 'GET', pathname: '/api/config' })).status, 401);
  const { result, token } = await pair();
  assert.equal(result.status, 200);
  assert.match(result.headers['Set-Cookie'], /^hml_admin_session=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/);
  assert.ok(token.length >= 40);
  assert.equal((await routes.dispatch({ method: 'GET', pathname: '/api/config', sessionToken: token })).status, 200);
});

test('logout revokes a session and expires the session cookie', async () => {
  const { routes, pair, auth } = setup();
  const { token } = await pair();
  const result = await routes.dispatch({ method: 'POST', pathname: '/api/logout', sessionToken: token });
  assert.equal(result.status, 200);
  assert.match(result.headers['Set-Cookie'], /Max-Age=0$/);
  assert.equal(auth.sessionStatus(token).authenticated, false);
});

