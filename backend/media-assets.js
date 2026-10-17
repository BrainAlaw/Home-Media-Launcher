'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { randomBytes } = require('node:crypto');
const { Readable } = require('node:stream');
const { memoryMediaStream } = require('./memory-media-stream');

const MEDIA_TYPES = Object.freeze({
  '.png': ['image/png', 'image'], '.jpg': ['image/jpeg', 'image'], '.jpeg': ['image/jpeg', 'image'],
  '.webp': ['image/webp', 'image'], '.gif': ['image/gif', 'image'], '.avif': ['image/avif', 'image'],
  '.mp4': ['video/mp4', 'video'], '.webm': ['video/webm', 'video'],
  '.mp3': ['audio/mpeg', 'audio'], '.wav': ['audio/wav', 'audio'], '.ogg': ['audio/ogg', 'audio']
});

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] ? (match[2] ? Math.min(Number(match[2]), size - 1) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end || (!match[1] && Number(match[2]) === 0)) return null;
  return { start, end };
}

class MediaAssets {
  constructor() {
    this.byToken = new Map();
    this.byPath = new Map();
    this.memoryCache = null;
  }

  setMemoryCache(cache) { this.memoryCache = cache; }

  descriptor(source) {
    try {
      const url = new URL(source);
      if (url.protocol !== 'vibepollo-media:' || url.host !== 'asset' || url.search || url.hash || !/^\/[a-f0-9]{48}$/.test(url.pathname)) return null;
      const token = url.pathname.slice(1);
      const asset = this.byToken.get(token);
      return asset ? { token, ...asset } : null;
    } catch { return null; }
  }

  /** Only explicitly registered local media can be addressed; URLs never contain filesystem paths. */
  async register(source, expectedKind) {
    if (typeof source !== 'string' || !source || source.length > 4096 || /[\x00-\x1f]/.test(source)) throw new Error('Invalid media source');
    const candidate = source.startsWith('file:') ? fileURLToPath(source) : source;
    if (!path.isAbsolute(candidate)) throw new Error('Media source must be an absolute local path or file URL');
    const file = await fs.realpath(candidate);
    const media = MEDIA_TYPES[path.extname(file).toLowerCase()];
    if (!media || media[1] !== expectedKind) throw new Error(`Expected a supported ${expectedKind} asset`);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('Media source must be a regular file');
    if (this.byPath.has(file)) return this.byPath.get(file);
    if (this.byToken.size >= 8192) throw new Error('Media registration limit reached');
    const token = randomBytes(24).toString('hex');
    const url = `vibepollo-media://asset/${token}`;
    this.byToken.set(token, { file, mime: media[0], kind: media[1] });
    this.byPath.set(file, url);
    return url;
  }

  /** Stream bounded chunks directly from an open file; never buffer complete videos in Electron. */
  async respond(request) {
    const url = new URL(request.url);
    if (url.protocol !== 'vibepollo-media:' || url.host !== 'asset' || url.search || url.hash || !/^\/[a-f0-9]{48}$/.test(url.pathname)) return new Response(null, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    const asset = this.byToken.get(url.pathname.slice(1));
    if (!asset) return new Response(null, { status: 404 });
    let handle;
    try {
      const cached = this.memoryCache?.get(url.pathname.slice(1));
      if (!cached) handle = await fs.open(asset.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = cached || await handle.stat();
      if (!cached && !stat.isFile()) return new Response(null, { status: 404 });
      const etag = `"${stat.size}-${stat.mtimeMs}"`;
      const headers = { 'Content-Type': asset.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=0, must-revalidate', ETag: etag, 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': 'null' };
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      let range = null;
      const requestedRange = request.headers.get('range');
      if (requestedRange && (!request.headers.get('if-range') || request.headers.get('if-range') === etag)) {
        range = byteRange(requestedRange, stat.size);
        if (!range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? stat.size - 1;
      headers['Content-Length'] = String(range ? end - start + 1 : stat.size);
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      const status = range ? 206 : 200;
      if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status, headers });
      if (cached) return new Response(memoryMediaStream(cached, asset.file, start, end, request.signal), { status, headers });
      const stream = handle.createReadStream({ start, end, autoClose: true, highWaterMark: 256 * 1024 });
      const abort = () => stream.destroy();
      request.signal?.addEventListener('abort', abort, { once: true });
      stream.once('close', () => request.signal?.removeEventListener('abort', abort));
      if (request.signal?.aborted) stream.destroy();
      handle = null;
      return new Response(Readable.toWeb(stream), { status, headers });
    } catch {
      return new Response(null, { status: 404 });
    } finally { await handle?.close(); }
  }
}

module.exports = { MediaAssets, byteRange };
