'use strict';

const { EventEmitter } = require('node:events');

/**
 * Holds the latest Vibepollo library snapshot and reports sync progress.
 * The fetcher (cache-aware, falls back to disk when the host is unreachable) is injected,
 * so this class stays free of Electron and network details.
 *
 * Events: `sync-progress` { phase, completed, total }, `updated` (snapshot).
 */
class LibraryService extends EventEmitter {
  constructor() {
    super();
    this.generation = 0;
    this.snapshot = { tiles: [], status: 'disabled', isVibepolloOffline: false, host: '', updatedAt: '', error: '', warning: '' };
  }

  /** Runs one fetch; concurrent runs are already coalesced by the fetcher itself. */
  async sync(fetcher) {
    const ticket = ++this.generation;
    const result = await fetcher((progress) => { if (ticket === this.generation) this.emit('sync-progress', progress); });
    // A newer sync started meanwhile: keep its snapshot instead of overwriting it with older data.
    return ticket === this.generation ? this.accept(result) : this.getGameLibrary();
  }

  accept(result) {
    this.snapshot = {
      tiles: result.tiles || [],
      status: result.status,
      // Cached or empty-offline libraries are still served; the flag drives the "Vibepollo Offline" indicator.
      isVibepolloOffline: result.status === 'offline' || result.status === 'cached',
      host: result.host || '',
      updatedAt: result.updatedAt || '',
      error: result.error || '',
      warning: result.warning || ''
    };
    this.emit('updated', this.snapshot);
    return this.snapshot;
  }

  /** Always resolves with the last known library, never rejects and never waits for the network. */
  getGameLibrary() { return structuredClone(this.snapshot); }
}

module.exports = { LibraryService };
