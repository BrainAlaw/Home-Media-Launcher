'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PANEL_PREFIX = '/admin/';
const DEFAULT_DOCUMENT = 'index.html';
const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
});

/**
 * Maps a request pathname to a file under `root`. Pure apart from path arithmetic; never touches the disk.
 * Only flat file names with an allowlisted extension are accepted. Separators, `..`, drive letters, `%` (after one
 * decode, so double-encoded input is refused too), NUL, dot files and absolute paths all yield null.
 * @param {string} pathname URL pathname, for example `/admin/panel.js`
 * @param {string} root absolute folder that holds the panel files
 * @returns {{ filePath: string, contentType: string } | null}
 */
function resolvePanelFile(pathname, root) {
  if (typeof pathname !== 'string' || !pathname.startsWith(PANEL_PREFIX)) return null;
  let name;
  try { name = decodeURIComponent(pathname.slice(PANEL_PREFIX.length)); }
  catch { return null; }
  if (name === '') name = DEFAULT_DOCUMENT;
  if (/[\0/\\:%]/.test(name) || name.startsWith('.')) return null;
  const contentType = CONTENT_TYPES[path.extname(name).toLowerCase()];
  if (!contentType) return null;
  const base = path.resolve(root);
  const filePath = path.join(base, name);
  if (path.dirname(filePath) !== base) return null;
  return { filePath, contentType };
}

function sendText(response, baseHeaders, status, message, headers = {}) {
  if (response.headersSent || response.destroyed) return;
  response.writeHead(status, {
    ...baseHeaders,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(message)),
    ...headers
  });
  response.end(message);
}

/**
 * Serves the admin panel files. Only GET and HEAD; everything outside the allowlist is a 404.
 * Every response, including errors, carries `baseHeaders` (the security headers from server.js).
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 * @param {string} root folder that holds the panel files
 * @param {Record<string, string>} [baseHeaders] headers added to every response
 */
async function serveStatic(request, response, root, baseHeaders = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, baseHeaders, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }
  let pathname;
  try { pathname = new URL(request.url, 'http://localhost').pathname; }
  catch { sendText(response, baseHeaders, 404, 'Not found'); return; }
  if (pathname === '/admin') {
    sendText(response, baseHeaders, 301, 'Moved', { Location: PANEL_PREFIX });
    return;
  }
  const resolved = resolvePanelFile(pathname, root);
  if (!resolved) { sendText(response, baseHeaders, 404, 'Not found'); return; }

  let stats;
  try { stats = await fs.promises.stat(resolved.filePath); }
  catch { sendText(response, baseHeaders, 404, 'Not found'); return; }
  if (!stats.isFile()) { sendText(response, baseHeaders, 404, 'Not found'); return; }

  if (response.headersSent || response.destroyed) return;
  response.writeHead(200, {
    ...baseHeaders,
    'Content-Type': resolved.contentType,
    'Content-Length': String(stats.size),
    'Cache-Control': 'no-cache'
  });
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = fs.createReadStream(resolved.filePath);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

module.exports = { PANEL_PREFIX, CONTENT_TYPES, resolvePanelFile, serveStatic };
