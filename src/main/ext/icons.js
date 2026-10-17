'use strict';

const { createIconResolver } = require('../../../backend/icon-resolver');
const { ICON_SIZES } = require('../../../backend/icon-sizes');
const { listPresets, addPresetWebsites, firstRunWebsites, presetIdFromIcon } = require('../../../backend/web-presets');

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

/** Preset ids used by the configured websites (`preset:<id>` ids / icon tokens / legacy bundled icon URLs). */
function usedPresetIds(ctx) {
  const websites = Array.isArray(ctx.config()?.websites) ? ctx.config().websites : [];
  const ids = websites.map((site) => (typeof site?.id === 'string' && site.id.startsWith('preset:') ? site.id.slice(7) : presetIdFromIcon(site?.icon)));
  return [...new Set(ids.filter(Boolean))];
}

/** ns `icons`: see backend/ICONS.md and the IconRequest / IconResult / WebPreset contracts. */
module.exports = {
  namespace: 'icons',
  handlers: {
    resolve: (ctx, request) => getResolver(ctx).resolve(request),
    listPresets: () => listPresets(),
    /** File URL of the tile art for one preset id (downloads the service icon on first use, cached 14 days). */
    resolvePresetIcon: (ctx, id) => getResolver(ctx).resolvePresetIcon(id),
    /** Instant { presetId: fileUrl } map (cached tile art or the bundled monogram tile) for all presets. */
    presetIcons: (ctx) => getResolver(ctx).presetIconMap(listPresets().map((preset) => preset.id)),
    /** Fetches missing tile art for the presets used by the configured websites; resolves with { presetId: fileUrl }. */
    refreshPresetIcons: (ctx) => getResolver(ctx).refreshPresetIcons(usedPresetIds(ctx)),
    searchArtwork: (ctx, query, art) => getResolver(ctx).searchArtwork(query, art),
    cacheCandidate: (ctx, url) => getResolver(ctx).cacheCandidate(url),
    /** Returns the existing websites array plus the requested presets (ids), without duplicates. The renderer saves it. */
    addPresetWebsites: (ctx, websites, presetIds) => addPresetWebsites(websites, presetIds),
    firstRunWebsites: () => firstRunWebsites(),
    sizes: () => ICON_SIZES,
    hasSteamGridDb: (ctx) => Boolean(ctx.secrets?.steamGridDbKey)
  },
  start(ctx) {
    const active = getResolver(ctx);
    active.prune().catch(() => {}).then(() => active.refreshPresetIcons(usedPresetIds(ctx))).catch(() => {});
  },
  stop() { resolver = null; resolverKey = ''; }
};
