'use strict';

const { Worker } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { authorization } = require('./network');

class ContextArtwork extends EventEmitter {
  constructor(directory, media) {
    super();
    this.directory = directory;
    this.media = media;
    this.entries = new Map();
    this.sources = new Map();
    this.jobs = new Map();
    this.pendingSources = new Map();
    this.worker = null;
    this.nextId = 0;
    this.manifest = {};
    this.closed = false;
    this.remoteAccess = null;
    this.spawning = null;
    this.failures = 0;
  }

  setRemoteAccess(remote, credential) {
    this.remoteAccess = null;
    if (!remote?.enabled || !remote.host || !credential) return;
    const host = remote.host.includes(':') && !remote.host.startsWith('[') ? `[${remote.host.trim()}]` : remote.host.trim();
    const origin = new URL(remote.apiUrl?.trim() || `https://${host}:47990`).origin;
    this.remoteAccess = { origin, headers: { Authorization: authorization(credential) }, allowSelfSigned: remote.allowSelfSigned === true };
  }

  async initialize() { await this.spawn(); }

  /** Starts (or restarts after a crash) the worker; resolves once it is ready, failed or exited. */
  spawn() {
    if (this.closed) return Promise.resolve();
    if (this.spawning) return this.spawning;
    const worker = new Worker(path.join(__dirname, 'context-artwork-worker.js'), { workerData: { directory: this.directory } });
    this.worker = worker;
    this.spawning = new Promise((resolve) => {
      const settle = () => { worker.unref(); this.spawning = null; resolve(); };
      worker.on('message', (message) => {
        if (message.ready) { this.manifest = message.manifest; this.failures = 0; settle(); return; }
        if (message.fatal) { this.emit('warning', new Error(message.fatal)); settle(); return; }
        if (Array.isArray(message.evicted)) for (const source of message.evicted) delete this.manifest[source];
        const job = this.jobs.get(message.id);
        if (!job) return;
        this.jobs.delete(message.id);
        this.pendingSources.delete(job.source);
        if (!this.jobs.size) worker.unref();
        if (message.record) this.manifest[job.source] = message.record;
        job.resolve(message.record || null);
      });
      worker.on('error', (error) => { this.emit('warning', error); this.failJobs(); settle(); });
      worker.on('exit', () => {
        if (this.worker === worker) { this.worker = null; this.failures++; }
        this.failJobs();
        settle();
      });
    });
    return this.spawning;
  }

  failJobs() {
    for (const job of this.jobs.values()) job.resolve(null);
    this.jobs.clear();
    this.pendingSources.clear();
  }

  download(source) {
    if (this.pendingSources.has(source)) return this.pendingSources.get(source);
    if (this.closed) return Promise.resolve(null);
    if (!this.worker) {
      // Crash recovery: lazily respawn, bounded so a permanently broken worker cannot loop.
      if (this.failures > 5) return Promise.resolve(null);
      return this.spawn().then(() => (this.worker ? this.download(source) : null));
    }
    if (this.jobs.size >= 1024) return Promise.resolve(null);
    const id = ++this.nextId;
    const pending = new Promise((resolve) => this.jobs.set(id, { source, resolve }));
    this.pendingSources.set(source, pending);
    this.worker.ref();
    let sameOrigin = false;
    try { sameOrigin = Boolean(this.remoteAccess && /^https:\/\//i.test(source) && new URL(source).origin === this.remoteAccess.origin); }
    catch { /* The worker rejects malformed sources without disrupting model construction. */ }
    this.worker.postMessage({ id, source, options: sameOrigin ? { headers: this.remoteAccess.headers, allowSelfSigned: this.remoteAccess.allowSelfSigned } : {} });
    return pending;
  }

  /** Warm local registrations outside the focus path and queue cold downloads on the worker. */
  async updateTiles(tiles) {
    const wanted = new Set();
    const warm = [];
    for (const tile of tiles.slice(0, 1024)) {
      if (typeof tile.id !== 'string') continue;
      wanted.add(tile.id);
      const kind = ['hero_image', 'fanart', 'background'].find((key) => typeof tile[key] === 'string' && tile[key]);
      const source = kind ? tile[kind] : null;
      const previous = this.entries.get(tile.id);
      const sameSource = this.sources.get(tile.id) === source;
      const expired = source && Date.now() - (this.manifest[source]?.updatedAt || 0) >= 86400000;
      if (sameSource && previous && (!source || previous.state === 'loading' || (previous.state === 'ready' && !expired))) continue;
      this.sources.set(tile.id, source);
      if (!sameSource || previous?.state !== 'ready') this.entries.set(tile.id, { appId: tile.id, state: source ? 'loading' : 'missing', url: null, kind: kind || null });
      if (!source) continue;
      const publish = async (record) => {
        let url = null;
        if (record) {
          try { url = await this.media.register(record.url, 'image'); } catch { /* Missing or invalid cached assets fall back gracefully. */ }
        }
        if (this.closed || this.sources.get(tile.id) !== source || !this.entries.has(tile.id)) return;
        const entry = { appId: tile.id, state: url ? 'ready' : 'missing', url, kind };
        const current = this.entries.get(tile.id);
        if (current.url === entry.url && current.state === entry.state && current.kind === entry.kind) return;
        this.entries.set(tile.id, entry);
        this.emit('changed', structuredClone(entry));
      };
      const cached = this.manifest[source];
      if (cached) warm.push(publish(cached));
      void this.download(source).then(publish).catch((error) => this.emit('warning', error));
    }
    for (const id of this.entries.keys()) if (!wanted.has(id)) { this.entries.delete(id); this.sources.delete(id); }
    await Promise.all(warm);
  }

  /** O(1), memory-only. Cold images return immediately and are delivered through change events. */
  getAppBackground(id) {
    if (typeof id !== 'string' || id.length > 1024) throw new Error('Invalid application ID');
    return { ...(this.entries.get(id) || { appId: id, state: 'missing', url: null, kind: null }) };
  }

  snapshot() { return Object.fromEntries([...this.entries].map(([id, entry]) => [id, { ...entry }])); }

  async close() {
    this.closed = true;
    this.failJobs();
    if (this.worker) await this.worker.terminate();
  }
}

module.exports = { ContextArtwork };
