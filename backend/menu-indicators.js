'use strict';

const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

class MenuIndicators extends EventEmitter {
  constructor() {
    super();
    this.snapshot = {
      revision: 0,
      system: { network: { linkAvailable: null, interfaceCount: 0 }, battery: { present: null, percent: null, onBattery: null }, sampledAt: null, error: '' },
      moonlight: { status: 'disabled', host: '', error: '', message: '', warning: '', updatedAt: '' }
    };
    this.worker = null;
  }

  start(intervalMs = 10000) {
    if (this.worker) return;
    this.worker = new Worker(path.join(__dirname, 'system-indicators-worker.js'), { workerData: { intervalMs: Math.max(1000, Number(intervalMs) || 10000) } });
    this.worker.on('message', (system) => { this.snapshot.system = system; this.publish(); });
    this.worker.on('error', () => { this.snapshot.system.error = 'System indicator worker unavailable'; this.publish(); });
    this.worker.on('exit', () => { this.worker = null; });
    this.worker.unref();
  }

  publish() { this.snapshot.revision++; this.emit('changed', this.get()); }
  updateMoonlight(status) { this.snapshot.moonlight = { ...status }; this.publish(); }
  get() { return structuredClone(this.snapshot); }
  async close() { const worker = this.worker; this.worker = null; this.removeAllListeners(); if (worker) { worker.removeAllListeners('message'); worker.removeAllListeners('error'); await worker.terminate(); } }
}

module.exports = { MenuIndicators };
