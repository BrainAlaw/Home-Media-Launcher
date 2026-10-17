'use strict';

const { VpnService } = require('../../../backend/vpn');

const POLL_INTERVAL_MS = 15_000;
let service = null;
let timer = null;
let signature = '';
let last = [];
let inflight = null;

/** Emits `status` only when the list changed; polling is async and never overlaps. */
function publish(ctx, listPromise) {
  return listPromise.then((list) => {
    last = list;
    const next = JSON.stringify(list);
    if (next !== signature) { signature = next; ctx.emit('status', list); }
    return list;
  });
}

function poll(ctx) {
  if (inflight) return inflight;
  inflight = publish(ctx, service.list()).catch(() => []).finally(() => { inflight = null; });
  return inflight;
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
    service = new VpnService({ getProfile: () => ctx.config()?.vpn?.surfsharkWireguardProfile || undefined });
    poll(ctx);
    timer = setInterval(() => poll(ctx), POLL_INTERVAL_MS);
    timer.unref?.();
  },
  stop() { clearInterval(timer); timer = null; }
};
