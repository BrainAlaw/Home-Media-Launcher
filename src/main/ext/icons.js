'use strict';

const { createIconResolver } = require('../../../backend/icon-resolver');
const { ICON_SIZES } = require('../../../backend/icon-sizes');
const { listPresets, addPresetWebsites, firstRunWebsites } = require('../../../backend/web-presets');

let resolver = null;
let resolverKey = '';

function hostnameOf(value) {
  try { return new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`).hostname; } catch { return ''; }
}

/** Hosts the user already configured (remote host, websites) may live on a private network. */
function trustedHostsFrom(ctx) {
  return () => {
    const settings = ctx.config() || {};
    const values = [settings.remote?.host, settings.remote?.apiUrl, ...(Array.isArray(settings.websites) ? settings.websites.map((site) => site?.url) : [])];
    return values.filter((value) => typeof value === 'string' && value.trim()).map((value) => hostnameOf(value.trim())).filter(Boolean);
  };
}

function getResolver(ctx) {
  const key = `${ctx.userData}|${ctx.secrets?.steamGridDbKey ? 'k' : ''}`;
  if (!resolver || resolverKey !== key) {
    resolver = createIconResolver({ userData: ctx.userData, secrets: ctx.secrets, trustedHosts: trustedHostsFrom(ctx) });
    resolverKey = key;
  }
  return resolver;
}

/** ns `icons`: see backend/ICONS.md and the IconRequest / IconResult / WebPreset contracts. */
module.exports = {
  namespace: 'icons',
  handlers: {
    resolve: (ctx, request) => getResolver(ctx).resolve(request),
    listPresets: () => listPresets(),
    searchArtwork: (ctx, query, art) => getResolver(ctx).searchArtwork(query, art),
    cacheCandidate: (ctx, url) => getResolver(ctx).cacheCandidate(url),
    /** Returns the existing websites array plus the requested presets (ids), without duplicates. The renderer saves it. */
    addPresetWebsites: (ctx, websites, presetIds) => addPresetWebsites(websites, presetIds),
    firstRunWebsites: () => firstRunWebsites(),
    sizes: () => ICON_SIZES,
    hasSteamGridDb: (ctx) => Boolean(ctx.secrets?.steamGridDbKey)
  },
  start(ctx) { getResolver(ctx).prune().catch(() => {}); },
  stop() { resolver = null; resolverKey = ''; }
};
