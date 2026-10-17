'use strict';

const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

class SlideshowCache extends EventEmitter {
  constructor(media, options = {}) {
    super();
    this.media = media;
    this.records = new Map();
    this.playlist = [];
    this.currentIndex = 0;
    this.lookAhead = 4;
    this.enabled = false;
    this.generation = 0;
    this.configureVersion = 0;
    this.focusUrl = null;
    this.bytes = 0;
    this.unavailable = new Set();
    this.wanted = new Set();
    this.closed = false;
    this.lastWindow = '';
    this.lastWindowAt = 0;
    this.configuration = null;
    this.workerOptions = {
      budget: options.budget ?? 256 * 1024 * 1024,
      fullLimit: options.fullLimit ?? 32 * 1024 * 1024,
      headBytes: options.headBytes ?? 16 * 1024 * 1024,
      tailBytes: options.tailBytes ?? 4 * 1024 * 1024
    };
    this.worker = null;
    this.spawn();
  }

  /** Starts the prefetch worker; also used for crash recovery on the next window update. */
  spawn() {
    const worker = new Worker(path.join(__dirname, 'slideshow-worker.js'), { workerData: this.workerOptions });
    this.worker = worker;
    worker.on('message', (message) => {
      if (this.closed || this.worker !== worker) return;
      this.bytes = message.bytes;
      if (message.type === 'cached') { this.records.set(message.record.token, message.record); this.unavailable.delete(message.record.token); }
      if (message.type === 'evicted') this.records.delete(message.token);
      if (message.type === 'unavailable') this.unavailable.add(message.token);
      if (message.type === 'settled' && message.generation === this.generation) {
        worker.unref();
        this.emit('changed', this.state());
      }
    });
    worker.on('error', (error) => {
      this.records.clear(); this.bytes = 0;
      this.emit('warning', error);
    });
    worker.on('exit', () => {
      if (this.worker !== worker) return;
      this.worker = null; this.lastWindow = '';
      this.records.clear(); this.bytes = 0;
    });
    worker.unref();
  }

  get(token) { return this.records.get(token); }

  async configure(slideshow) {
    const signature = JSON.stringify(slideshow || null);
    if (signature === this.configuration && !this.playlist.some((asset) => !asset.url)) return;
    const version = ++this.configureVersion;
    const playlist = await Promise.all((slideshow?.assets || []).map(async (asset) => {
      try { return { type: asset.type, url: await this.media.register(asset.source, asset.type) }; }
      catch { return { type: asset.type, url: null }; }
    }));
    if (this.closed || version !== this.configureVersion) return;
    this.playlist = playlist;
    this.configuration = signature;
    this.enabled = slideshow?.enabled === true;
    this.lookAhead = slideshow?.lookAhead ?? 4;
    this.currentIndex = 0;
    this.lastWindow = '';
    this.focusUrl = null;
    this.setPosition(0);
  }

  setPosition(index, focusUrl = this.focusUrl) {
    if (!Number.isSafeInteger(index) || index < 0 || (this.playlist.length ? index >= this.playlist.length : index !== 0)) throw new Error('Invalid slideshow index');
    this.currentIndex = index;
    this.focusUrl = focusUrl;
    const urls = focusUrl ? [focusUrl] : [];
    if (this.enabled) for (let offset = 0; offset < Math.min(this.playlist.length, this.lookAhead + 1); offset++) {
      const url = this.playlist[(index + offset) % this.playlist.length].url;
      if (url) urls.push(url);
    }
    const assets = [...new Set(urls)].map((url) => this.media.descriptor(url)).filter(Boolean);
    this.wanted = new Set(assets.map((asset) => asset.token));
    const signature = JSON.stringify(assets.map((asset) => asset.token));
    if (this.closed) return;
    if (!this.worker) this.spawn();
    if (signature === this.lastWindow && Date.now() - this.lastWindowAt < 5000) return;
    this.lastWindow = signature;
    this.lastWindowAt = Date.now();
    this.generation++;
    this.unavailable.clear();
    this.worker.ref();
    this.worker.postMessage({ generation: this.generation, assets });
  }

  state() {
    return {
      currentIndex: this.currentIndex, lookAhead: this.lookAhead, enabled: this.enabled, cachedBytes: this.bytes,
      slides: this.playlist.map((asset) => {
        const descriptor = asset.url ? this.media.descriptor(asset.url) : null;
        const record = descriptor ? this.records.get(descriptor.token) : null;
        return { ...asset, memory: record ? (record.complete ? 'full' : 'partial') : (!descriptor || this.unavailable.has(descriptor.token) ? 'unavailable' : (this.wanted.has(descriptor.token) ? 'pending' : 'cold')) };
      })
    };
  }

  async close() {
    this.closed = true;
    this.records.clear();
    this.bytes = 0;
    if (this.worker) await this.worker.terminate();
  }
}

module.exports = { SlideshowCache };
