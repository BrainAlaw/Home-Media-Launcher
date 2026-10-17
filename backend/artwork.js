'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { atomicWrite, serialize } = require('./storage');
const { requestBuffer } = require('./network');

const MAX_BYTES = 8 * 1024 * 1024;

function imageExtension(body) {
  if (body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png';
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return '.jpg';
  if (['GIF87a', 'GIF89a'].includes(body.subarray(0, 6).toString())) return '.gif';
  if (body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  if (body.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return '.ico';
  throw new Error('Artwork must be a PNG, JPEG, GIF, WebP or ICO image');
}

async function cacheArtwork(source, directory, options = {}) {
  if (typeof source !== 'string' || !source) return '';
  let body;
  if (/^https?:\/\//i.test(source)) {
    const { body: downloaded } = await (options.requestBuffer || requestBuffer)(source, {
      maxBytes: MAX_BYTES, timeoutMs: 5000, headers: options.headers || {}, allowSelfSigned: options.allowSelfSigned === true
    });
    body = downloaded;
  } else if (source.startsWith('data:image/')) {
    const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(source);
    if (!match || match[1].length > Math.ceil(MAX_BYTES * 4 / 3) + 4) throw new Error('Invalid image data URL');
    body = Buffer.from(match[1], 'base64');
  } else {
    const file = source.startsWith('file:') ? fileURLToPath(source) : source;
    if (!path.isAbsolute(file)) throw new Error('Artwork path must be absolute');
    const handle = await fs.open(file, 'r');
    try {
      if ((await handle.stat()).size > MAX_BYTES) throw new Error('Artwork exceeds size limit');
      body = await handle.readFile();
    } finally { await handle.close(); }
  }
  if (body.length > MAX_BYTES) throw new Error('Artwork exceeds size limit');
  const extension = imageExtension(body);
  const destination = path.join(directory, `${createHash('sha256').update(body).digest('hex')}${extension}`);
  await serialize(destination, async () => {
    try { await fs.access(destination); }
    catch { await atomicWrite(destination, body); }
  });
  return pathToFileURL(destination).href;
}

const CONTENT_FILE = /^[0-9a-f]{64}\.(png|jpg|gif|webp|ico)$/;
const TEMP_FILE = /^[0-9a-f]{64}\.(png|jpg|gif|webp|ico)\.[0-9a-f-]{36}\.tmp$/;

/**
 * Deletes content-addressed artwork that no current cache references. Only files this module
 * created (hash names or its own temp files) and older than `minAgeMs` are touched, so concurrent
 * writers and foreign files are never removed. Returns the number of deleted files.
 */
async function pruneArtwork(directory, referenced, { minAgeMs = 3600000 } = {}) {
  const keep = new Set();
  for (const url of referenced) {
    try { keep.add(path.basename(fileURLToPath(url))); } catch { /* Non-file references own no artwork. */ }
  }
  let names;
  try { names = await fs.readdir(directory); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    const isContent = CONTENT_FILE.test(name);
    if (!isContent && !TEMP_FILE.test(name)) continue;
    if (isContent && keep.has(name)) continue;
    const file = path.join(directory, name);
    try {
      const stats = await fs.stat(file);
      if (!stats.isFile() || Date.now() - stats.mtimeMs < minAgeMs) continue;
      await serialize(file, () => fs.rm(file, { force: true }));
      removed += 1;
    } catch { /* A file that vanished or is locked is retried on the next sync. */ }
  }
  return removed;
}

module.exports = { cacheArtwork, imageExtension, pruneArtwork };
