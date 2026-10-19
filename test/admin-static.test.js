'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createAdminAuth } = require('../src/main/admin/auth');
const { createAdminRoutes } = require('../src/main/admin/routes');
const { createAdminServer, SECURITY_HEADERS } = require('../src/main/admin/server');
const { resolvePanelFile, serveStatic } = require('../src/main/admin/static');
const { GROUPS, SETTINGS, INTERNAL_PATHS } = require('../backend/settings-descriptor');
const { ACTIONS } = require('../backend/actions');
const { OBJECT_FIELDS } = require('../src/main/admin/object-fields');

const ROOT = path.join(os.tmpdir(), 'hml-admin-static-root');
const OUTSIDE_SECRET = 'outside-secret-token';

function prepareFixtures() {
  const parent = path.join(os.tmpdir(), 'hml-admin-static-parent');
  fs.rmSync(parent, { recursive: true, force: true });
  fs.mkdirSync(path.join(parent, 'panel', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(parent, 'secret.json'), `{"token":"${OUTSIDE_SECRET}"}`);
  fs.writeFileSync(path.join(parent, 'panel', 'index.html'), '<!doctype html><title>panel</title>');
  fs.writeFileSync(path.join(parent, 'panel', 'panel.js'), 'export const ready = true;');
  fs.writeFileSync(path.join(parent, 'panel', 'panel.css'), 'body { margin: 0; }');
  fs.writeFileSync(path.join(parent, 'panel', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(parent, 'panel', 'pixel.png'), Buffer.from('89504e47', 'hex'));
  fs.writeFileSync(path.join(parent, 'panel', 'data.json'), '{"ok":true}');
  fs.writeFileSync(path.join(parent, 'panel', 'notes.txt'), 'not served');
  fs.writeFileSync(path.join(parent, 'panel', '.hidden.js'), 'hidden');
  fs.writeFileSync(path.join(parent, 'panel', 'nested', 'deep.js'), 'deep');
  return path.join(parent, 'panel');
}

function unusedLoopbackPort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(() => resolve(port));
    });
  });
}

/** Sends a request with the path exactly as written (no client-side normalisation of `..`). */
function rawRequest({ port, method = 'GET', rawPath }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: rawPath }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('resolvePanelFile maps allowlisted flat files and the default document', () => {
  const root = path.resolve(ROOT);
  assert.deepEqual(resolvePanelFile('/admin/', root), { filePath: path.join(root, 'index.html'), contentType: 'text/html; charset=utf-8' });
  assert.deepEqual(resolvePanelFile('/admin/panel.js', root), { filePath: path.join(root, 'panel.js'), contentType: 'text/javascript; charset=utf-8' });
  assert.equal(resolvePanelFile('/admin/panel.css', root).contentType, 'text/css; charset=utf-8');
  assert.equal(resolvePanelFile('/admin/data.json', root).contentType, 'application/json; charset=utf-8');
  assert.equal(resolvePanelFile('/admin/icon.svg', root).contentType, 'image/svg+xml');
  assert.equal(resolvePanelFile('/admin/pixel.PNG', root).contentType, 'image/png');
  assert.equal(resolvePanelFile('/admin/%70anel.js', root).filePath, path.join(root, 'panel.js'));
});

test('resolvePanelFile refuses traversal, encoded separators, absolute paths and drive letters', () => {
  const root = path.resolve(ROOT);
  const refused = [
    '/admin/../secret.json',
    '/admin/..%2fsecret.json',
    '/admin/%2e%2e%2fsecret.json',
    '/admin/%2E%2E%5Csecret.json',
    '/admin/..%5csecret.json',
    '/admin/%252e%252e%252fsecret.json',
    '/admin/%2fetc%2fpasswd.js',
    '/admin/%5cwindows%5cwin.ini.js',
    '/admin/C:%5Cwindows%5Cwin.js',
    '/admin/C:panel.js',
    '/admin/%2F%2Fserver%2Fshare.js',
    '/admin/nested/deep.js',
    '/admin/%00panel.js',
    '/admin/.hidden.js',
    '/admin/.',
    '/admin/..',
    '/admin/%E0%A4%A.js',
    '/admin/notes.txt',
    '/admin/panel',
    '/admin/panel.exe',
    '/other/panel.js',
    '/admin.js'
  ];
  for (const pathname of refused) assert.equal(resolvePanelFile(pathname, root), null, pathname);
  assert.equal(resolvePanelFile(undefined, root), null);
});

test('serveStatic serves files with per-extension types, no-cache and the security headers', async () => {
  const panelRoot = prepareFixtures();
  const port = await unusedLoopbackPort();
  const server = http.createServer((request, response) => { void serveStatic(request, response, panelRoot, SECURITY_HEADERS); });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    const index = await rawRequest({ port, rawPath: '/admin/' });
    assert.equal(index.status, 200);
    assert.equal(index.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(index.headers['cache-control'], 'no-cache');
    assert.equal(index.headers['content-security-policy'], "default-src 'self'");
    assert.equal(index.headers['x-content-type-options'], 'nosniff');
    assert.equal(index.headers['referrer-policy'], 'no-referrer');
    assert.equal(index.body, '<!doctype html><title>panel</title>');

    const script = await rawRequest({ port, rawPath: '/admin/panel.js' });
    assert.equal(script.status, 200);
    assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal(script.headers['content-length'], String(Buffer.byteLength('export const ready = true;')));

    const head = await rawRequest({ port, method: 'HEAD', rawPath: '/admin/panel.css' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-type'], 'text/css; charset=utf-8');
    assert.equal(head.body, '');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serveStatic answers 404 for traversal and blocked files, 301 for /admin and 405 for writes', async () => {
  const panelRoot = prepareFixtures();
  const port = await unusedLoopbackPort();
  const server = http.createServer((request, response) => { void serveStatic(request, response, panelRoot, SECURITY_HEADERS); });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  try {
    for (const rawPath of ['/admin/../secret.json', '/admin/..%2fsecret.json', '/admin/%2e%2e%2fsecret.json', '/admin/%5c..%5csecret.json', '/admin/C:%5Cwindows.js', '/admin/nested/deep.js', '/admin/.hidden.js', '/admin/notes.txt', '/admin/missing.js', '/admin/nested']) {
      const response = await rawRequest({ port, rawPath });
      assert.equal(response.status, 404, rawPath);
      assert.ok(!response.body.includes(OUTSIDE_SECRET), rawPath);
    }
    const redirect = await rawRequest({ port, rawPath: '/admin' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, '/admin/');
    const write = await rawRequest({ port, method: 'PUT', rawPath: '/admin/panel.js' });
    assert.equal(write.status, 405);
    assert.equal(write.headers.allow, 'GET, HEAD');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('settings description exposes groups, settings and internal paths without any secret value', async () => {
  const routes = createAdminRoutes({
    auth: createAdminAuth(),
    getConfig: async () => ({ settings: { apiToken: 'secret-value-123' } }),
    validate: () => {},
    saveConfig: () => {}
  });
  const response = await routes.dispatch({ method: 'GET', pathname: '/api/settings-description' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { GROUPS, SETTINGS, INTERNAL_PATHS, ACTIONS, OBJECT_FIELDS });
  const serialised = JSON.stringify(response.body);
  assert.ok(!serialised.includes('secret-value-123'));
  for (const entry of SETTINGS) {
    assert.doesNotMatch(entry.path, /token|secret|password|apikey|api_key/i, entry.path);
    if (typeof entry.default === 'string') assert.doesNotMatch(entry.default, /token|secret|password/i, entry.path);
  }
  const post = await routes.dispatch({ method: 'POST', pathname: '/api/settings-description' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
});

test('admin server serves the panel path through static serving and keeps the JSON API separate', async () => {
  const port = await unusedLoopbackPort();
  const server = createAdminServer({
    getConfig: async () => ({ settings: { admin: { enabled: true, bindAddress: '127.0.0.1', port } }, rows: [] }),
    saveConfig: async () => {},
    validate: () => {}
  });
  const url = await server.start();
  try {
    const missingAsset = await fetch(`${url}/admin/missing.js`);
    assert.equal(missingAsset.status, 404);
    assert.equal(missingAsset.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(missingAsset.headers.get('content-security-policy'), "default-src 'self'");

    const description = await fetch(`${url}/api/settings-description`);
    assert.equal(description.status, 200);
    assert.equal(description.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await description.json();
    assert.deepEqual(Object.keys(body).sort(), ['ACTIONS', 'GROUPS', 'INTERNAL_PATHS', 'OBJECT_FIELDS', 'SETTINGS']);
  } finally {
    await server.stop();
  }
});
