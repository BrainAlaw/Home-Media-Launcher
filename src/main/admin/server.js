'use strict';

const http = require('node:http');
const net = require('node:net');
const { createAdminAuth } = require('./auth');
const { createAdminRoutes } = require('./routes');

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 64 * 1024;
const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store'
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function defaultBindAddress() {
  try {
    const interfaces = process.report?.getReport?.().header?.networkInterfaces || [];
    const candidate = interfaces.find((entry) => entry.internal === false && entry.family === 'IPv4' && net.isIPv4(entry.address));
    return candidate?.address || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}


function getSessionToken(request) {
  const cookie = request.headers.cookie;
  if (typeof cookie !== 'string') return '';
  for (const entry of cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== 'hml_admin_session') continue;
    return entry.slice(separator + 1).trim();
  }
  return '';
}

function isMutation(method) {
  return method === 'POST' || method === 'PUT' || method === 'DELETE';
}

function hasRequestBody(request) {
  return request.headers['transfer-encoding'] !== undefined
    || (request.headers['content-length'] !== undefined && Number(request.headers['content-length']) > 0);
}

async function readJsonBody(request) {
  if (!hasRequestBody(request)) return undefined;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    request.resume();
    throw new HttpError(413, 'Request body is too large');
  }
  const chunks = [];
  let total = 0;
  let oversized = false;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      oversized = true;
      chunks.length = 0;
      continue;
    }
    if (!oversized) chunks.push(chunk);
  }
  if (oversized) throw new HttpError(413, 'Request body is too large');
  if (total === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Malformed JSON'); }
}

function sendJson(response, status, body, headers = {}) {
  if (response.headersSent || response.destroyed) return;
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(encoded.length),
    ...headers
  });
  response.end(encoded);
}

function createAdminServer({ getConfig, saveConfig, validate, onPairCode = () => {}, log = () => {} }) {
  const auth = createAdminAuth();
  const routes = createAdminRoutes({ getConfig, saveConfig, validate, auth });
  let server = null;
  let enabled = false;
  let bindAddress = null;
  let boundPort = null;
  let boundUrl = null;
  let stopping = null;

  async function currentAdminSettings() {
    const config = await getConfig();
    return config?.settings?.admin && typeof config.settings.admin === 'object' ? config.settings.admin : {};
  }

  async function handleRequest(request, response) {
    try {
      if (isMutation(request.method)) {
        const expectedOrigin = `http://${bindAddress}:${boundPort}`;
        const providedOrigin = request.headers.origin;
        const requestMarker = request.headers['x-hml-request'] === '1';
        const validOrigin = providedOrigin === expectedOrigin
          || (providedOrigin === undefined && request.headers['sec-fetch-site'] === 'same-origin');
        if (!requestMarker || !validOrigin) throw new HttpError(403, 'Request origin check failed');
      }
      const body = await readJsonBody(request);
      let pathname;
      try { pathname = new URL(request.url, boundUrl).pathname; }
      catch { throw new HttpError(400, 'Invalid request path'); }
      const result = await routes.dispatch({
        method: request.method,
        pathname,
        body,
        address: request.socket.remoteAddress,
        sessionToken: getSessionToken(request)
      });
      sendJson(response, result.status, result.body, result.headers);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      const message = status === 500 ? 'Internal server error' : error.message;
      sendJson(response, status, { error: message });
    }
  }

  async function start() {
    if (server?.listening) return boundUrl;
    const settings = await currentAdminSettings();
    if (settings.enabled !== true) {
      enabled = false;
      return null;
    }
    const explicitAddress = Object.hasOwn(settings, 'bindAddress') && settings.bindAddress !== '';
    const address = explicitAddress ? settings.bindAddress : defaultBindAddress();
    if (typeof address !== 'string' || !net.isIPv4(address) || (address === '0.0.0.0' && !explicitAddress)) {
      throw new Error('Admin bindAddress must be an IPv4 address; 0.0.0.0 must be explicitly configured');
    }
    const port = settings.port === undefined ? DEFAULT_PORT : settings.port;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Admin port must be an integer from 0 to 65535');

    enabled = true;
    bindAddress = address;
    server = http.createServer((request, response) => { void handleRequest(request, response); });
    server.on('error', (error) => logSafely({ event: 'admin-server-error', code: error.code || 'UNKNOWN' }));
    server.on('clientError', (_error, socket) => {
      if (!socket.writable) return;
      const body = Buffer.from(JSON.stringify({ error: 'Malformed HTTP request' }));
      const headers = [
        'HTTP/1.1 400 Bad Request',
        ...Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}`),
        'Content-Type: application/json; charset=utf-8',
        `Content-Length: ${body.length}`,
        'Connection: close',
        '',
        body.toString('utf8')
      ];
      socket.end(headers.join('\r\n'));
    });
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => { server?.off('listening', onListening); reject(error); };
        const onListening = () => { server?.off('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, address);
      });
      const socketAddress = server.address();
      if (!socketAddress || typeof socketAddress === 'string') throw new Error('Admin server did not bind to a TCP address');
      boundPort = socketAddress.port;
      boundUrl = `http://${bindAddress}:${boundPort}`;
      logSafely({ event: 'admin-listening', address: bindAddress, port: boundPort });
      return boundUrl;
    } catch (error) {
      server?.close();
      server = null;
      enabled = false;
      bindAddress = null;
      boundPort = null;
      boundUrl = null;
      throw error;
    }
  }

  async function stop() {
    if (stopping) return stopping;
    const active = server;
    if (!active?.listening) {
      server = null;
      boundPort = null;
      boundUrl = null;
      return;
    }
    stopping = new Promise((resolve, reject) => active.close((error) => {
      server = null;
      boundPort = null;
      boundUrl = null;
      stopping = null;
      if (error) reject(error); else resolve();
    }));
    return stopping;
  }

  async function pair() {
    const settings = await currentAdminSettings();
    if (settings.enabled !== true) throw new Error('Admin server is disabled');
    const pairing = auth.createPairCode();
    await onPairCode({ code: pairing.code, expiresAt: pairing.expiresAt });
    return { expiresAt: pairing.expiresAt };
  }

  function status() {
    return { enabled, running: Boolean(server?.listening), bindAddress, port: boundPort, url: boundUrl };
  }

  function logSafely(entry) {
    try { log(entry); } catch { /* Logging must not affect the admin endpoint. */ }
  }


  return { start, stop, status, pair };
}

module.exports = { DEFAULT_PORT, MAX_BODY_BYTES, SECURITY_HEADERS, defaultBindAddress, createAdminServer };
