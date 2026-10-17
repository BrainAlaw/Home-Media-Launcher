'use strict';

const { VpnService, resolveSurfsharkSettings } = require('../../../backend/vpn');
const { createGatedPoller } = require('../activity');

const POLL_INTERVAL_MS = 15_000;
let service = null;
let poller = null;
let signature = '';
let last = [];
let inflight = null;

/** Emits `status` only when the list changed; polling is async and never overlaps. */
function publish(ctx, listPromise, signal) {
  return listPromise.then((list) => {
    if (signal?.aborted) return last;
    last = list;
    const next = JSON.stringify(list);
    if (next !== signature) { signature = next; ctx.emit('status', list); }
    return list;
  });
}

function poll(ctx, signal) {
  if (inflight) return inflight;
  const own = publish(ctx, service.list(), signal).catch(() => []).finally(() => { if (inflight === own) inflight = null; });
  inflight = own;
  // An aborted poll (session started) must not block the refresh that follows the resume.
  signal?.addEventListener('abort', () => { if (inflight === own) inflight = null; }, { once: true });
  return own;
}

module.exports = {
  namespace: 'vpn',
  handlers: {
    list: (ctx) => publish(ctx, service.list()),
    toggle: (ctx, id, enabled) => {
      if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('Invalid VPN request');
      // Announce the busy state immediately, then the result once the command has finished.
      const pending = service.toggle(id, enabled).finally(() => { signature = ''; });
      ctx.emit('status', last.map((entry) => (entry.id === id ? { ...entry, busy: true } : entry)));
      return publish(ctx, pending);
    }
  },
  start(ctx) {
    service = new VpnService({ getSettings: () => resolveSurfsharkSettings(ctx.config()?.vpn) });
    poller = createGatedPoller({ intervalMs: POLL_INTERVAL_MS, task: (signal) => poll(ctx, signal) });
    poller.start();
  },
  stop() { poller?.stop(); poller = null; }
};
