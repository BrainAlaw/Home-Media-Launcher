'use strict';

const { EventEmitter } = require('node:events');

/** Serial polling prevents overlap when a host takes longer than the poll interval. */
class HostMonitor extends EventEmitter {
  constructor(refresh, intervalMs = 30000) {
    super();
    this.refresh = refresh;
    this.intervalMs = intervalMs;
    this.running = false;
    this.timer = null;
    this.pending = null;
  }

  poll() {
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(this.refresh)
      .then((result) => { this.emit('updated', result); return result; })
      .catch((error) => { this.emit('failure', error); return null; })
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const schedule = () => {
      if (!this.running) return;
      this.timer = setTimeout(async () => { await this.poll(); schedule(); }, this.intervalMs);
      this.timer.unref?.();
    };
    schedule();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }
}

module.exports = { HostMonitor };
