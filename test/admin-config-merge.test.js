'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdminAuth } = require('../src/main/admin/auth');
const { createAdminRoutes, SESSION_COOKIE } = require('../src/main/admin/routes');

async function setup(initial) {
  const auth = createAdminAuth({ randomInt: () => 7, randomBytes: (size) => Buffer.alloc(size, 3) });
  let stored = initial;
  const seen = { validated: [], saved: [] };
  const routes = createAdminRoutes({
    auth,
    getConfig: async () => stored,
    validate: (config) => { seen.validated.push(config); if (config.settings?.bad) throw new Error('bad fixture'); },
    saveConfig: async (config) => { seen.saved.push(config); stored = config; }
  });
  const pairing = auth.createPairCode();
  const paired = await routes.dispatch({ method: 'POST', pathname: '/api/pair', body: { code: pairing.code }, address: '127.0.0.1' });
  const token = paired.headers['Set-Cookie'].split(';')[0].slice(`${SESSION_COOKIE}=`.length);
  const put = (body) => routes.dispatch({ method: 'PUT', pathname: '/api/config', sessionToken: token, body });
  return { put, seen, stored: () => stored };
}

const baseConfig = () => ({
  settings: {
    title: 'Living room',
    remote: { host: 'vibepollo.local', apiToken: 'stored-secret', moonlightArgs: ['--a'] },
    wallpaperSources: [{ id: 'a', token: 'token-a' }, { id: 'b', token: 'token-b' }]
  },
  rows: [{ title: 'Home', tiles: [] }],
  websites: [{ name: 'Docs', url: 'https://example.com' }],
  menu: { items: ['x'] }
});

test('PUT with a settings patch keeps rows, websites and menu from the stored config', async () => {
  const { put, stored } = await setup(baseConfig());
  const result = await put({ settings: { title: 'Bedroom' } });
  assert.equal(result.status, 200);
  assert.equal(stored().settings.title, 'Bedroom');
  assert.deepEqual(stored().rows, [{ title: 'Home', tiles: [] }]);
  assert.deepEqual(stored().websites, [{ name: 'Docs', url: 'https://example.com' }]);
  assert.deepEqual(stored().menu, { items: ['x'] });
});

test('PUT keeps untouched nested settings and replaces only what the patch names', async () => {
  const { put, stored } = await setup(baseConfig());
  await put({ settings: { remote: { moonlightArgs: ['--b'] } } });
  assert.equal(stored().settings.remote.host, 'vibepollo.local');
  assert.equal(stored().settings.remote.apiToken, 'stored-secret');
  assert.deepEqual(stored().settings.remote.moonlightArgs, ['--b']);
});

test('redacted markers on secret keys keep the stored secret, a real value replaces it', async () => {
  const { put, stored } = await setup(baseConfig());
  await put({ settings: { remote: { apiToken: '<set>' } } });
  assert.equal(stored().settings.remote.apiToken, 'stored-secret');
  await put({ settings: { remote: { apiToken: 'new-secret' } } });
  assert.equal(stored().settings.remote.apiToken, 'new-secret');
});

test('redacted markers inside arrays merge with the stored item at the same index', async () => {
  const { put, stored } = await setup(baseConfig());
  await put({ settings: { wallpaperSources: [{ id: 'a', token: '<set>' }, { id: 'b', token: '<set>' }] } });
  assert.deepEqual(stored().settings.wallpaperSources, [{ id: 'a', token: 'token-a' }, { id: 'b', token: 'token-b' }]);
});

test('a marker on a non-secret key is written as given, and unsafe keys are ignored', async () => {
  const { put, stored } = await setup(baseConfig());
  await put({ settings: JSON.parse('{"title":"<set>","__proto__":{"polluted":true},"constructor":{"x":1}}') });
  assert.equal(stored().settings.title, '<set>');
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(stored().settings, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stored().settings, '__proto__'), false);
});

test('validation sees the merged config and an invalid merge is not saved', async () => {
  const { put, seen, stored } = await setup(baseConfig());
  const result = await put({ settings: { bad: true } });
  assert.equal(result.status, 422);
  assert.equal(seen.validated.at(-1).rows.length, 1);
  assert.equal(seen.saved.length, 0);
  assert.equal(stored().settings.title, 'Living room');
});

test('settings that are not an object are refused with 422', async () => {
  const { put, seen } = await setup(baseConfig());
  const result = await put({ settings: 'yes' });
  assert.equal(result.status, 422);
  assert.equal(result.body.error, 'settings must be an object');
  assert.equal(seen.saved.length, 0);
});
