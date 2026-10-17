'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { atomicWrite, readJson } = require('../../backend/storage');
const { requestJson, authorization } = require('../../backend/network');
const { cacheArtwork, pruneArtwork } = require('../../backend/artwork');
const { moonlightCommand } = require('../../backend/moonlight');

const inFlight = new Map();

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { values.push(value); value = ''; }
    else value += character;
  }
  values.push(value);
  return values;
}

function createRemoteTile(remote, name, id, icon = '') {
  return {
    id: `remote:${remote.host}:${id || name}`,
    name,
    icon,
    command: remote.moonlightPath || 'moonlight',
    args: [...(remote.moonlightArgs || []), 'stream', remote.host, name, ...(remote.streamArgs || [])],
    remote: true
  };
}

function parseMoonlightCsv(output, remote) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  return lines.slice(1).map(parseCsvLine)
    .filter((fields) => fields[0] && fields[4] !== 'true')
    .map((fields) => createRemoteTile(remote, fields[0], fields[1], fields[6]));
}

function parseApiApps(payload, remote) {
  const apps = Array.isArray(payload) ? payload : payload?.apps ?? payload?.data;
  if (!Array.isArray(apps)) throw new Error('VibePollo returned an unsupported application list');
  if (apps.some((item) => !item || typeof (item.name || item.title) !== 'string' || !(item.name || item.title).trim())) throw new Error('Host returned an invalid application');
  return apps.filter((item) => item.hidden !== true)
    .map((item) => ({
      ...createRemoteTile(remote, item.name || item.title, item.id ?? item.uuid ?? item.name ?? item.title, item.cover || item.icon || (/^https?:\/\//i.test(item['image-path'] || '') ? item['image-path'] : '')),
      ...(typeof item.hero_image === 'string' ? { hero_image: item.hero_image } : {}),
      ...(typeof item.fanart === 'string' ? { fanart: item.fanart } : {})
    }));
}

async function readCache(cachePath, remote) {
  try {
    const cache = await readJson(cachePath, {});
    if (cache?.host !== remote.host.trim() || (cache.apiUrl || '') !== (remote.apiUrl?.trim() || '') || !Array.isArray(cache.tiles)) return [];
    return cache.tiles.filter((tile) => tile && typeof tile.id === 'string' && typeof tile.name === 'string' && tile.name && typeof tile.icon === 'string');
  } catch { return []; }
}

/** Drops artwork referenced by neither the fresh cache nor the user's icon overrides. */
async function pruneOrphans(cachePath, tiles) {
  try {
    const directory = path.dirname(cachePath);
    const overrides = await readJson(path.join(directory, 'icon-overrides.json'), {});
    const icons = overrides?.icons && typeof overrides.icons === 'object' ? Object.values(overrides.icons) : [];
    await pruneArtwork(path.join(directory, 'artwork'), [...tiles.map((tile) => tile.icon), ...icons].filter((value) => typeof value === 'string'));
  } catch { /* Pruning is best effort and must never fail a sync. */ }
}

async function moonlightTiles(remote, options) {
  const run = options.run || promisify(execFile);
  const { stdout } = await run(remote.moonlightPath, [...(remote.moonlightArgs || []), 'list', remote.host, '--csv'], {
    windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024
  });
  if (!/^\s*"?Name"?\s*,/im.test(stdout)) throw new Error('Moonlight returned an unsupported application list');
  return parseMoonlightCsv(stdout, remote);
}

async function listRemoteApps(remote, cachePath, options = {}) {
  if (!remote?.enabled || !remote.host?.trim()) return { tiles: [], status: 'disabled' };
  const key = JSON.stringify([cachePath, remote, options.token, options.cacheOnly === true]);
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = syncRemoteApps(remote, cachePath, options).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function syncRemoteApps(remote, cachePath, options) {
  const report = (progress) => { try { options.onProgress?.(progress); } catch { /* Progress listeners must never break a sync. */ } };
  report({ phase: 'metadata', completed: 0, total: 0 });
  const cached = await readCache(cachePath, remote);
  let normalized;
  try {
    const resolved = await moonlightCommand(remote, options.platform);
    normalized = { ...remote, host: remote.host.trim(), moonlightPath: resolved.command, moonlightArgs: resolved.prefix };
    if (normalized.host.startsWith('-') || /[\s\x00-\x1f]/.test(normalized.host)) throw new Error('Invalid remote host');
    if (options.cacheOnly) throw new Error('Checking host availability');
    let tiles;
    let apiUrl;
    if (remote.apiUrl?.trim() || options.token) {
      if (!options.token) throw new Error('Remote API credentials are not configured');
      const host = normalized.host.includes(':') && !normalized.host.startsWith('[') ? `[${normalized.host}]` : normalized.host;
      apiUrl = remote.apiUrl?.trim() || `https://${host}:47990`;
      const payload = await (options.requestJson || requestJson)(`${apiUrl.replace(/\/$/, '')}/api/apps`, options.token, remote.allowSelfSigned === true);
      tiles = parseApiApps(payload, normalized);
      const oldById = new Map(cached.map((tile) => [tile.id, tile]));
      for (const tile of tiles) {
        const previous = oldById.get(tile.id);
        if (!tile.icon && previous?.icon && Date.now() - previous.iconCachedAt < 86400000) tile.icon = previous.iconSource || previous.icon;
      }
      // Sunshine exposes server-local cover paths. The paired client provides usable local boxart URLs.
      if (tiles.some((tile) => !tile.icon)) {
        try {
          const artworkByName = new Map((await moonlightTiles(normalized, options)).map((tile) => [tile.name, tile.icon]));
          for (const tile of tiles) if (!tile.icon) tile.icon = artworkByName.get(tile.name) || '';
        } catch { /* API metadata stays available even when the client has not paired yet. */ }
      }
    } else {
      tiles = await moonlightTiles(normalized, options);
    }
    const old = new Map(cached.map((tile) => [tile.id, tile]));
    let completed = 0;
    report({ phase: 'artwork', completed, total: tiles.length });
    // Four workers bound simultaneous downloads; unchanged artwork is refreshed daily.
    let cursor = 0;
    const artworkDeadline = Date.now() + 10000;
    const cacheTile = async (tile) => {
      const previous = old.get(tile.id);
      const source = tile.icon;
      if (Date.now() >= artworkDeadline) {
        tile.icon = previous?.icon || '';
        if (previous?.icon && previous.iconSource) Object.assign(tile, { iconSource: previous.iconSource, iconCachedAt: previous.iconCachedAt });
        return;
      }
      if (previous?.icon && previous.iconSource === source && Date.now() - previous.iconCachedAt < 86400000) {
        try { await fs.access(require('node:url').fileURLToPath(previous.icon)); Object.assign(tile, { icon: previous.icon, iconSource: source, iconCachedAt: previous.iconCachedAt }); return; }
        catch { /* Rebuild missing artwork. */ }
      }
      try {
        const sameOrigin = apiUrl && /^https?:\/\//i.test(source) && new URL(source).origin === new URL(apiUrl).origin;
        tile.icon = await cacheArtwork(source, path.join(path.dirname(cachePath), 'artwork'), {
          requestBuffer: options.requestBuffer,
          headers: sameOrigin ? { Authorization: authorization(options.token) } : {},
          allowSelfSigned: sameOrigin && remote.allowSelfSigned === true
        });
        tile.iconSource = source;
        tile.iconCachedAt = Date.now();
      } catch {
        tile.icon = previous?.icon || '';
        if (previous?.icon && previous.iconSource) Object.assign(tile, { iconSource: previous.iconSource, iconCachedAt: previous.iconCachedAt });
      }
    };
    const workers = Array.from({ length: Math.min(4, tiles.length) }, async () => {
      while (cursor < tiles.length) {
        await cacheTile(tiles[cursor++]);
        completed += 1;
        report({ phase: 'artwork', completed, total: tiles.length });
      }
    });
    await Promise.all(workers);
    const updatedAt = new Date().toISOString();
    report({ phase: 'complete', completed: tiles.length, total: tiles.length });
    let warning = '';
    try { await atomicWrite(cachePath, JSON.stringify({ host: normalized.host, apiUrl: remote.apiUrl?.trim() || '', updatedAt, tiles })); }
    catch { warning = 'Host is online, but the local cache could not be saved'; }
    if (!warning) await pruneOrphans(cachePath, tiles);
    return { tiles, status: 'online', host: normalized.host, updatedAt, warning };
  } catch (error) {
    report({ phase: 'offline', completed: 0, total: 0 });
    // Cached metadata never controls execution: rebuild commands from current settings.
    const tiles = normalized ? cached.map((tile) => ({
      ...createRemoteTile(normalized, tile.name, tile.id, tile.icon), id: tile.id,
      ...(typeof tile.hero_image === 'string' ? { hero_image: tile.hero_image } : {}),
      ...(typeof tile.fanart === 'string' ? { fanart: tile.fanart } : {})
    })) : [];
    return { tiles, status: tiles.length ? 'cached' : 'offline', host: remote.host.trim(), error: error.message };
  }
}

module.exports = { listRemoteApps, parseApiApps, parseCsvLine, parseMoonlightCsv, requestJson };
