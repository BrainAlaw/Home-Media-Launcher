'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const test = require('node:test');
const { createAdminServer, MAX_BODY_BYTES, SECURITY_HEADERS } = require('../src/main/admin/server');

async function unusedLoopbackPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function makeServer({ enabled = true, config: configOverrides = {} } = {}) {
  const port = await unusedLoopbackPort();
  const state = {
    config: {
      settings: {
        admin: { enabled, bindAddress: '127.0.0.1', port },
        apiToken: 'top-secret', nested: { clientPassword: '', visible: true }
      },
      rows: []
    },
    pairing: null,
    saved: 0,
    logs: []
  };
  Object.assign(state.config.settings.admin, configOverrides);
  const server = createAdminServer({
    getConfig: async () => state.config,
    saveConfig: async (next) => { state.config = next; state.saved += 1; },
    validate: (next) => { if (next?.invalid) throw new Error('fixture validation failure'); },
    onPairCode: (pairing) => { state.pairing = pairing; },
    log: (entry) => state.logs.push(entry)
  });
  return { server, state, port };
}

function secureHeaders(response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
}

function mutationHeaders(origin, extra = {}) {
  return { 'Content-Type': 'application/json', 'X-HML-Request': '1', ...(origin ? { Origin: origin } : {}), ...extra };
}

test('admin HTTP server listens only after start and uses configured loopback address', async (t) => {
  const { server, port } = await makeServer();
  t.after(() => server.stop());
  assert.equal(server.status().running, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
  const url = await server.start();
  assert.equal(url, `http://127.0.0.1:${port}`);
  assert.equal(server.status().running, true);
  const response = await fetch(`${url}/api/health`);
  assert.equal(response.status, 200);
  secureHeaders(response);
});

test('admin server remains stopped when disabled', async (t) => {
  const { server, port } = await makeServer({ enabled: false });
  t.after(() => server.stop());
  assert.equal(await server.start(), null);
  assert.equal(server.status().running, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
});

test('mutating requests reject wrong Origin and missing X-HML-Request', async (t) => {
  const { server } = await makeServer();
  t.after(() => server.stop());
  const url = await server.start();
  const wrongOrigin = await fetch(`${url}/api/pair`, {
    method: 'POST', headers: mutationHeaders('http://evil.example'), body: JSON.stringify({ code: '000000' })
  });
  assert.equal(wrongOrigin.status, 403);
  secureHeaders(wrongOrigin);
  const missingMarker = await fetch(`${url}/api/logout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: '{}'
  });
  assert.equal(missingMarker.status, 403);
  secureHeaders(missingMarker);
  const sameOriginWithoutOrigin = await fetch(`${url}/api/logout`, {
    method: 'POST', headers: mutationHeaders(undefined, { 'Sec-Fetch-Site': 'same-origin' }), body: '{}'
  });
  assert.equal(sameOriginWithoutOrigin.status, 200);
});

test('request bodies require JSON, reject malformed JSON, and stop above 64 KiB', async (t) => {
  const { server } = await makeServer();
  t.after(() => server.stop());
  const url = await server.start();
  const noJson = await fetch(`${url}/api/pair`, {
    method: 'POST', headers: { ...mutationHeaders(url), 'Content-Type': 'text/plain' }, body: 'not json'
  });
  assert.equal(noJson.status, 415);
  secureHeaders(noJson);
  const malformed = await fetch(`${url}/api/pair`, {
    method: 'POST', headers: mutationHeaders(url), body: '{'
  });
  assert.equal(malformed.status, 400);
  secureHeaders(malformed);
  const large = await fetch(`${url}/api/config`, {
    method: 'PUT', headers: mutationHeaders(url), body: JSON.stringify({ padding: 'x'.repeat(MAX_BODY_BYTES) })
  });
  assert.equal(large.status, 413);
  secureHeaders(large);
});

test('pairing flow returns a session cookie, redacts config, saves valid updates once, and logs out', async (t) => {
  const { server, state } = await makeServer();
  t.after(() => server.stop());
  const url = await server.start();
  assert.equal((await server.pair()).expiresAt, state.pairing.expiresAt);
  const headers = mutationHeaders(url);
  const pair = await fetch(`${url}/api/pair`, { method: 'POST', headers, body: JSON.stringify({ code: state.pairing.code }) });
  assert.equal(pair.status, 200);
  secureHeaders(pair);
  const cookie = pair.headers.get('set-cookie');
  assert.match(cookie, /^hml_admin_session=[A-Za-z0-9_-]+; HttpOnly; SameSite=Strict; Path=\//);
  assert.match(cookie, /Max-Age=43200/);

  const sessionCookie = cookie.split(';')[0];
  const configResponse = await fetch(`${url}/api/config`, { headers: { Cookie: sessionCookie } });
  assert.equal(configResponse.status, 200);
  secureHeaders(configResponse);
  const config = await configResponse.json();
  assert.equal(config.settings.apiToken, '<set>');
  assert.equal(config.settings.nested.clientPassword, '<unset>');
  assert.equal(config.settings.nested.visible, true);

  const invalid = await fetch(`${url}/api/config`, {
    method: 'PUT', headers: { ...headers, Cookie: sessionCookie }, body: JSON.stringify({ invalid: true })
  });
  assert.equal(invalid.status, 422);
  assert.equal(state.saved, 0);

  const valid = await fetch(`${url}/api/config`, {
    method: 'PUT', headers: { ...headers, Cookie: sessionCookie }, body: JSON.stringify({ settings: { title: 'Updated' }, rows: [] })
  });
  assert.equal(valid.status, 200);
  assert.equal(state.saved, 1);
  assert.equal(state.config.settings.title, 'Updated');

  const logout = await fetch(`${url}/api/logout`, { method: 'POST', headers: { ...headers, Cookie: sessionCookie }, body: '{}' });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0$/);
  const session = await fetch(`${url}/api/session`, { headers: { Cookie: sessionCookie } });
  assert.deepEqual(await session.json(), { authenticated: false, expiresAt: null });
  assert.equal(state.logs.every((entry) => entry.event === 'admin-listening'), true);
});

test('pair failures remain unauthorized and routes return 404 and 405', async (t) => {
  const { server } = await makeServer();
  t.after(() => server.stop());
  const url = await server.start();
  const wrongCode = await fetch(`${url}/api/pair`, { method: 'POST', headers: mutationHeaders(url), body: JSON.stringify({ code: '000000' }) });
  assert.equal(wrongCode.status, 401);
  const missing = await fetch(`${url}/api/missing`);
  assert.equal(missing.status, 404);
  const wrongMethod = await fetch(`${url}/api/config`, { method: 'POST', headers: mutationHeaders(url), body: '{}' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET, PUT');
});
