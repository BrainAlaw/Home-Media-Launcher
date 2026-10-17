'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { atomicWrite, serialize } = require('./storage');
const { requestBuffer: defaultRequestBuffer } = require('./network');
const { imageExtension } = require('./artwork');
const { CATALOG } = require('./online-wallpapers-catalog');

const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 30000;
const PREFETCH_CONCURRENCY = 2;
const DEFAULT_PRUNE_BYTES = 512 * 1024 * 1024;
const CACHED_FILE = /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/;
const TEMP_FILE = /\.tmp$/;

/** Streams a curated wallpaper catalog into a bounded on-disk cache. Only catalog URLs are fetched. */
class OnlineWallpapers extends EventEmitter {
  constructor(userDataDir, mediaAssets = null, { requestBuffer = defaultRequestBuffer } = {}) {
    super();
    if (typeof userDataDir !== 'string' || !path.isAbsolute(userDataDir)) throw new Error('userDataDir must be an absolute path');
    this.directory = path.join(userDataDir, 'online-wallpapers');
    this.mediaAssets = mediaAssets;
    this.requestBuffer = requestBuffer;
    this.entries = new Map(CATALOG.map((entry) => [entry.id, entry]));
    this.inflight = new Map();
  }

  /** Catalog entries (copies). `url` stays server-side-only data; the renderer may use `thumbUrl` for previews. */
  catalog() { return CATALOG.map((entry) => ({ ...entry })); }

  has(id) { return this.entries.has(id); }

  basename(entry) { return createHash('sha256').update(entry.url).digest('hex'); }

  async findCached(entry) {
    const base = this.basename(entry);
    for (const extension of ['.jpg', '.png', '.webp', '.gif']) {
      const file = path.join(this.directory, base + extension);
      try {
        if ((await fs.stat(file)).isFile()) {
          const now = new Date();
          await fs.utimes(file, now, now).catch(() => {});
          return file;
        }
      } catch { /* Not cached with this extension. */ }
    }
    return null;
  }

  /** Resolve to the absolute path of the cached image, downloading it on first use. */
  ensureCached(id) {
    const entry = typeof id === 'string' ? this.entries.get(id) : undefined;
    if (!entry) return Promise.reject(new Error('Unknown online wallpaper'));
    const running = this.inflight.get(id);
    if (running) return running;
    const task = this.download(entry).finally(() => this.inflight.delete(id));
    this.inflight.set(id, task);
    return task;
  }

  async download(entry) {
    const cached = await this.findCached(entry);
    if (cached) return cached;
    let body;
    try {
      ({ body } = await this.requestBuffer(entry.url, {
        maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, headers: { Accept: 'image/*', 'User-Agent': 'HomeMediaLauncher/1.0' }
      }));
    } catch (error) {
      const failure = new Error(`Online wallpaper "${entry.name}" is unavailable: ${error.message}`);
      this.emit('warning', failure);
      throw failure;
    }
    let extension;
    try {
      if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_BYTES) throw new Error('Unexpected response size');
      extension = imageExtension(body);
      if (!['.png', '.jpg', '.gif', '.webp'].includes(extension)) throw new Error('Unsupported image type');
    } catch (error) {
      const failure = new Error(`Online wallpaper "${entry.name}" returned invalid image data: ${error.message}`);
      this.emit('warning', failure);
      throw failure;
    }
    const destination = path.join(this.directory, this.basename(entry) + extension);
    try { await serialize(destination, () => atomicWrite(destination, body)); }
    catch (error) {
      const failure = new Error(`Cannot cache online wallpaper "${entry.name}": ${error.message}`);
      this.emit('warning', failure);
      throw failure;
    }
    return destination;
  }

  /** Warm the cache for the given ids, two at a time. Failures are ignored (reported via 'warning'). */
  async prefetch(ids) {
    const queue = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => this.entries.has(id));
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const id = queue[cursor++];
        try { await this.ensureCached(id); } catch { /* Already reported as a warning. */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, worker));
  }

  async listCache() {
    let names;
    try { names = await fs.readdir(this.directory); } catch { return []; }
    const files = [];
    for (const name of names) {
      if (!CACHED_FILE.test(name)) continue;
      const file = path.join(this.directory, name);
      try {
        const stats = await fs.stat(file);
        if (stats.isFile()) files.push({ file, size: stats.size, mtimeMs: stats.mtimeMs });
      } catch { /* Vanished between readdir and stat. */ }
    }
    return files;
  }

  /** Evict least-recently-used files (by mtime) until the cache fits in maxBytes. Returns removed count. */
  async prune(maxBytes = DEFAULT_PRUNE_BYTES) {
    const files = await this.listCache();
    let total = files.reduce((sum, item) => sum + item.size, 0);
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let removed = 0;
    for (const item of files) {
      if (total <= maxBytes) break;
      try {
        await serialize(item.file, () => fs.rm(item.file, { force: true }));
        total -= item.size;
        removed += 1;
      } catch (error) { this.emit('warning', new Error(`Cannot evict cached wallpaper: ${error.message}`)); }
    }
    return removed;
  }

  /** Delete every cached wallpaper and stray temp file. Returns removed count. */
  async clear() {
    let names;
    try { names = await fs.readdir(this.directory); } catch { return 0; }
    let removed = 0;
    for (const name of names) {
      if (!CACHED_FILE.test(name) && !TEMP_FILE.test(name)) continue;
      try { await fs.rm(path.join(this.directory, name), { force: true }); removed += 1; }
      catch (error) { this.emit('warning', new Error(`Cannot delete cached wallpaper: ${error.message}`)); }
    }
    return removed;
  }
}

module.exports = { OnlineWallpapers, MAX_BYTES };
