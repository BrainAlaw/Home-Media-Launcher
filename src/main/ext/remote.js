'use strict';

/**
 * ns `remote`: Vibepollo host identity for the Gaming section header.
 * Methods: `getHostInfo()`. Events: `host` (VibepolloHostInfo).
 * Hostname and IP fall back to VP_HOST / VP_IP when `settings.remote.host` is empty. The API key (VP_API)
 * is only ever used inside the main process as a default credential and is never part of any payload.
 */

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const OFFLINE_STATES = new Set(['offline', 'cached']);

/** Strips protocol, credentials, port and path so a configured address can be shown as a bare host. */
function bareHost(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`).hostname.replace(/^\[|\]$/g, '');
  } catch { return text; }
}

/** Remote settings with an empty host replaced by the environment default. */
function withHostDefaults(remote, secrets = {}) {
  const settings = remote && typeof remote === 'object' ? remote : {};
  if (typeof settings.host === 'string' && settings.host.trim()) return settings;
  const fallback = secrets.vibepolloHost || secrets.vibepolloIp || '';
  return fallback ? { ...settings, host: fallback } : settings;
}

/** Stored credential wins; the environment key is a main-process-only default. */
function defaultCredential(credential, secrets = {}) {
  return credential || secrets.vibepolloApiKey || '';
}

/**
 * @param {{ remote?: Record<string, any>, secrets?: Record<string, string>, status?: { status?: string, updatedAt?: string } | null }} input
 * @returns {import('../../../backend/contracts').VibepolloHostInfo}
 */
function buildHostInfo({ remote, secrets = {}, status = null } = {}) {
  const effective = withHostDefaults(remote, secrets);
  const address = bareHost(effective.host);
  const ip = IPV4.test(address) ? address : (secrets.vibepolloIp || '');
  const hostname = address && !IPV4.test(address) ? address : (secrets.vibepolloHost || address);
  const known = status?.status;
  let state = 'disabled';
  if (remote?.enabled && address) state = OFFLINE_STATES.has(known) ? known : (known === 'online' ? 'online' : 'offline');
  const syncedAt = status?.updatedAt ? Date.parse(status.updatedAt) : NaN;
  return { hostname, ip, status: state, ...(Number.isFinite(syncedAt) ? { lastSyncAt: syncedAt } : {}) };
}

let context = null;
let lastStatus = null;

/** Called by the main process whenever the library sync produces a new remote status. */
function publish(status) {
  lastStatus = status || null;
  if (context) context.emit('host', buildHostInfo({ remote: context.config().remote, secrets: context.secrets, status: lastStatus }));
}

module.exports = {
  namespace: 'remote',
  handlers: {
    getHostInfo: (ctx) => buildHostInfo({ remote: ctx.config().remote, secrets: ctx.secrets, status: lastStatus })
  },
  start(ctx) { context = ctx; },
  stop() { context = null; lastStatus = null; },
  publish,
  buildHostInfo,
  withHostDefaults,
  defaultCredential,
  bareHost
};
