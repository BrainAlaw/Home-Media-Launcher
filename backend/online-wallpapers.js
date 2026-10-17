'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { atomicWrite, serialize } = require('./storage');
const { requestBuffer: defaultRequestBuffer } = require('./network');
const { guardedLookup } = require('./site-fetch');

/** Blocks DNS answers that point at loopback/LAN addresses (catalogue hosts are user supplied). */
const publicOnlyLookup = guardedLookup([]);
const { imageExtension } = require('./artwork');
const { CATALOG } = require('./online-wallpapers-catalog');
const { parseCatalogue, creditFor, MAX_CATALOGUE_BYTES } = require('./online-catalogue');
const { normaliseSources, parseOnlineLocation, BUILTIN_PROVIDERS } = require('../src/renderer/wallpaper-sources');

const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 30000;
const PREFETCH_CONCURRENCY = 2;
const DEFAULT_PRUNE_BYTES = 512 * 1024 * 1024;
const CACHED_FILE = /^[0-9a-f]{64}\.(png|jpg|gif|webp)$/;
const TEMP_FILE = /\.tmp$/;
const CATALOGUE_TTL_MS = 6 * 60 * 60 * 1000;
const CATALOGUE_TIMEOUT_MS = 12000;
const READY_TIMEOUT_MS = 12000;
const BUILTIN_LOCATION = BUILTIN_PROVIDERS[0].location;

/**
 * Streams wallpaper catalogues into a bounded on-disk cache. Only addresses listed by an enabled catalogue are fetched:
 * the curated built-in catalogue plus user-added https catalogues (see settings.wallpaperSources).
 */
class OnlineWallpapers extends EventEmitter {
  constructor(userDataDir, mediaAssets = null, { requestBuffer = defaultRequestBuffer, now = Date.now } = {}) {
    super();
    if (typeof userDataDir !== 'string' || !path.isAbsolute(userDataDir)) throw new Error('userDataDir must be an absolute path');
    this.directory = path.join(userDataDir, 'online-wallpapers');
    this.mediaAssets = mediaAssets;
    this.requestBuffer = requestBuffer;
    this.catalogueDirectory = path.join(userDataDir, 'online-catalogues');
    this.now = now;
    /** Enabled online sources; null keeps the legacy behaviour (built-in catalogue only). */
    this.sources = null;
    /** Entries downloadable right now (enabled sources only), by id. */
    this.entries = new Map(CATALOG.map((entry) => [entry.id, entry]));
    /** Loaded custom catalogues by location: { at, name, entries, error, stale }. */
    this.loaded = new Map();
    this.loadingCatalogues = new Map();
    this.loading = null;
    this.inflight = new Map();
  }

  /**
   * Selects which online sources feed `catalog()`. Custom catalogues load in the background; `ready()` waits for them.
   * @param {unknown} sources settings.wallpaperSources (folders are ignored); null restores the default.
   */
  setSources(sources) {
    this.sources = Array.isArray(sources) ? normaliseSources(sources).filter((source) => source.kind === 'online' && source.enabled) : null;
    this.rebuild();
    this.loading = this.refresh();
    this.loading.catch(() => {});
  }

  /** Enabled sources, defaulting to the built-in catalogue. */
  activeSources() {
    return this.sources ?? [{ id: 'builtin', kind: 'online', location: BUILTIN_LOCATION, label: '', enabled: true }];
  }

  rebuild() {
    const entries = new Map();
    for (const source of this.activeSources()) {
      const list = source.location === BUILTIN_LOCATION ? CATALOG : (this.loaded.get(source.location)?.entries || []);
      for (const entry of list) entries.set(entry.id, entry);
    }
    this.entries = entries;
  }

  async refresh() {
    const custom = this.activeSources().filter((source) => source.location !== BUILTIN_LOCATION);
    let cursor = 0;
    const worker = async () => {
      while (cursor < custom.length) await this.loadCatalogue(custom[cursor++].location).catch(() => {});
    };
    await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, custom.length) }, worker));
    this.rebuild();
    this.emit('changed');
  }

  /** Resolves once pending catalogue loads settle, or after a short timeout so the slideshow never stalls. */
  async ready() {
    if (!this.loading) return;
    let timer;
    await Promise.race([this.loading.catch(() => {}), new Promise((resolve) => { timer = setTimeout(resolve, READY_TIMEOUT_MS); timer.unref?.(); })]);
    clearTimeout(timer);
  }

  catalogueFile(location) { return path.join(this.catalogueDirectory, `${createHash('sha256').update(location).digest('hex')}.json`); }

  /** Loads (network first, disk fallback) one custom catalogue and records the outcome in `this.loaded`. */
  loadCatalogue(location, { force = false } = {}) {
    const parsed = parseOnlineLocation(location);
    if (!parsed.ok || parsed.builtin) return Promise.reject(new Error(parsed.ok ? 'Not a custom catalogue' : parsed.error));
    const known = this.loaded.get(parsed.location);
    if (!force && known && !known.error && this.now() - known.at < CATALOGUE_TTL_MS) return Promise.resolve(known);
    const running = this.loadingCatalogues.get(parsed.location);
    if (running) return running;
    const task = this.fetchCatalogue(parsed.location).finally(() => this.loadingCatalogues.delete(parsed.location));
    this.loadingCatalogues.set(parsed.location, task);
    return task;
  }

  async fetchCatalogue(location) {
    const sourceId = `src-${createHash('sha256').update(location).digest('hex').slice(0, 10)}`;
    const file = this.catalogueFile(location);
    let result;
    try {
      const { body } = await this.requestBuffer(location, {
        lookup: publicOnlyLookup, maxBytes: MAX_CATALOGUE_BYTES, timeoutMs: CATALOGUE_TIMEOUT_MS, headers: { Accept: 'application/json', 'User-Agent': 'HomeMediaLauncher/1.0' }
      });
      const catalogue = parseCatalogue(body, sourceId);
      result = { at: this.now(), name: catalogue.name, entries: catalogue.entries, error: '', stale: false };
      try { await serialize(file, () => atomicWrite(file, body)); } catch { /* the in-memory copy still works this session */ }
    } catch (error) {
      try {
        const catalogue = parseCatalogue(await fs.readFile(file), sourceId);
        result = { at: this.now(), name: catalogue.name, entries: catalogue.entries, error: `Using saved copy: ${error.message}`, stale: true };
      } catch {
        result = { at: this.now(), name: '', entries: [], error: error.message, stale: false };
      }
      this.emit('warning', new Error(`Online wallpaper source ${new URL(location).hostname}: ${error.message}`));
    }
    this.loaded.set(location, result);
    this.rebuild();
    return result;
  }

  /** Checks a source before it is added: fetches and validates the catalogue. Never throws for network failures. */
  async probe(location) {
    const parsed = parseOnlineLocation(location);
    if (!parsed.ok) return { ok: false, error: parsed.error, count: 0, name: '' };
    if (parsed.builtin) return { ok: true, error: '', count: CATALOG.length, name: BUILTIN_PROVIDERS[0].label };
    const result = await this.loadCatalogue(parsed.location, { force: true });
    return { ok: result.entries.length > 0 && !result.stale, error: result.error, count: result.entries.length, name: result.name };
  }

  /** Entries for one source location (loaded catalogues only; never triggers a download). */
  entriesFor(location) {
    return location === BUILTIN_LOCATION ? CATALOG : (this.loaded.get(location)?.entries || []);
  }

  /** Count, availability and cache usage for a source (draft or saved). */
  async stats(location) {
    const parsed = parseOnlineLocation(location);
    if (!parsed.ok) return { count: 0, available: false, cacheBytes: 0, error: parsed.error };
    let error = '';
    if (!parsed.builtin) {
      let loaded = this.loaded.get(parsed.location);
      if (!loaded) loaded = await this.loadCatalogue(parsed.location).catch((failure) => ({ entries: [], error: failure.message }));
      error = loaded.error || '';
    }
    const entries = this.entriesFor(parsed.location);
    const bases = new Set(entries.map((entry) => this.basename(entry)));
    let cacheBytes = 0;
    for (const item of await this.listCache()) if (bases.has(path.basename(item.file, path.extname(item.file)))) cacheBytes += item.size;
    return { count: entries.length, available: entries.length > 0, cacheBytes, error };
  }

  /** Enabled catalogue entries (copies). `url` stays server-side-only data; the renderer may use `thumbUrl` for previews. */
  catalog() { return [...this.entries.values()].map((entry) => ({ ...entry })); }

  has(id) { return this.entries.has(id); }

  /** Credit metadata (title, author, licence, source) for an enabled entry, or null. */
  credit(id) {
    const entry = typeof id === 'string' ? this.entries.get(id) : undefined;
    return entry ? creditFor(entry, 'online') : null;
  }

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
        lookup: publicOnlyLookup, maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, headers: { Accept: 'image/*', 'User-Agent': 'HomeMediaLauncher/1.0' }
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
