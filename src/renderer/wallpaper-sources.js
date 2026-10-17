(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WallpaperSources = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Pure helpers for `settings.wallpaperSources` (see Iteration4Settings in backend/contracts.d.ts).
   * Shared by the settings dialog (renderer) and the main process (validation, online source loading).
   *
   * @typedef {{ id: string, label: string, kind: 'folder' | 'online', location: string, enabled: boolean }} WallpaperSource
   * @typedef {{ path: string, name: string }} WallpaperFolder
   */

  const MAX_SOURCES = 32;
  const MAX_LOCATION_LENGTH = 2048;
  const MAX_LABEL_LENGTH = 80;
  const BUILTIN_PREFIX = 'builtin:';
  const ID_PATTERN = /^[a-z0-9][a-z0-9:_.-]{0,63}$/i;
  const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|\/|\\\\)/i;
  const CONTROL_CHARACTERS = /[\u0000-\u001f]/;

  /** Known online providers that ship with the launcher. Only these may use the `builtin:` scheme. */
  const BUILTIN_PROVIDERS = Object.freeze([
    Object.freeze({
      id: 'wikimedia-commons',
      label: 'Wikimedia Commons (curated)',
      location: `${BUILTIN_PREFIX}wikimedia-commons`,
      host: 'commons.wikimedia.org',
      description: 'Hand-picked CC0 and public-domain landscapes, cities and space photography.'
    })
  ]);

  /** Short, stable, non-cryptographic hash used to derive readable source ids. */
  function shortHash(text) {
    let hash = 5381;
    for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
    return hash.toString(36);
  }

  /** @param {string} host */
  function isPrivateHost(host) {
    const name = host.toLowerCase().replace(/\.$/, '');
    if (!name || name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || name.endsWith('.internal') || name.endsWith('.lan')) return true;
    if (name.startsWith('[') || name.includes(':')) return true; // IPv6 literals are never needed for public catalogues.
    const octets = name.split('.');
    if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
      const [a, b] = octets.map(Number);
      return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    return !name.includes('.'); // single-label hosts resolve on the local network only
  }

  /**
   * Validates the location of an online source: a known `builtin:` provider or an https URL
   * (no credentials, no private/LAN hosts, no fragments).
   * @param {unknown} value
   * @returns {{ ok: true, location: string, host: string, builtin: string } | { ok: false, error: string }}
   */
  function parseOnlineLocation(value) {
    if (typeof value !== 'string') return { ok: false, error: 'Enter a web address' };
    const text = value.trim();
    if (!text) return { ok: false, error: 'Enter a web address' };
    if (text.length > MAX_LOCATION_LENGTH || CONTROL_CHARACTERS.test(text)) return { ok: false, error: 'The address is too long or contains invalid characters' };
    if (text.toLowerCase().startsWith(BUILTIN_PREFIX)) {
      const provider = BUILTIN_PROVIDERS.find((candidate) => candidate.location === text.toLowerCase());
      return provider ? { ok: true, location: provider.location, host: provider.host, builtin: provider.id } : { ok: false, error: 'Unknown built-in provider' };
    }
    let url;
    try { url = new URL(text); } catch { return { ok: false, error: 'That is not a valid web address' }; }
    if (url.protocol !== 'https:') return { ok: false, error: 'Only https:// addresses are allowed' };
    if (url.username || url.password) return { ok: false, error: 'Addresses must not contain a user name or password' };
    if (isPrivateHost(url.hostname)) return { ok: false, error: 'Local and private network addresses are not allowed' };
    url.hash = '';
    return { ok: true, location: url.href, host: url.hostname, builtin: '' };
  }

  /** @param {string} location */
  function folderName(location) {
    return location.split(/[\\/]/).filter(Boolean).pop() || location;
  }

  /**
   * Returns a well-formed source or null. Unknown ids are regenerated from the location so they stay stable.
   * @param {unknown} raw
   * @returns {WallpaperSource | null}
   */
  function normaliseSource(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const { kind } = /** @type {any} */ (raw);
    const entry = /** @type {Record<string, unknown>} */ (raw);
    if (kind !== 'folder' && kind !== 'online') return null;
    let location;
    let defaultLabel;
    if (kind === 'folder') {
      location = typeof entry.location === 'string' ? entry.location.trim() : '';
      if (!location || location.length > 4096 || CONTROL_CHARACTERS.test(location) || !ABSOLUTE_PATH.test(location)) return null;
      defaultLabel = folderName(location);
    } else {
      const parsed = parseOnlineLocation(entry.location);
      if (!parsed.ok) return null;
      location = parsed.location;
      defaultLabel = parsed.builtin ? BUILTIN_PROVIDERS.find((provider) => provider.id === parsed.builtin).label : parsed.host;
    }
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, MAX_LABEL_LENGTH) : defaultLabel;
    const id = typeof entry.id === 'string' && ID_PATTERN.test(entry.id) ? entry.id : `${kind}-${shortHash(location)}`;
    return { id, label, kind, location, enabled: entry.enabled !== false };
  }

  /**
   * Cleans a persisted list: drops malformed entries, de-duplicates by kind + location and by id, caps the length.
   * @param {unknown} list
   * @returns {WallpaperSource[]}
   */
  function normaliseSources(list) {
    if (!Array.isArray(list)) return [];
    const seenLocations = new Set();
    const seenIds = new Set();
    /** @type {WallpaperSource[]} */
    const result = [];
    for (const raw of list) {
      const source = normaliseSource(raw);
      if (!source) continue;
      const locationKey = `${source.kind}|${source.location}`;
      if (seenLocations.has(locationKey)) continue;
      let id = source.id;
      if (seenIds.has(id)) id = `${source.kind}-${shortHash(source.location)}`;
      if (seenIds.has(id)) continue;
      seenLocations.add(locationKey);
      seenIds.add(id);
      result.push({ ...source, id });
      if (result.length >= MAX_SOURCES) break;
    }
    return result;
  }

  /**
   * The effective source list. When `wallpaperSources` was never saved, it is migrated from the legacy
   * `wallpaper.folders` + `wallpaper.online` settings so existing installs keep their folders and online toggle.
   * @param {{ folders?: WallpaperFolder[], online?: boolean } | undefined} wallpaper
   * @param {unknown} sources
   * @returns {{ sources: WallpaperSource[], migrated: boolean }}
   */
  function deriveSources(wallpaper, sources) {
    if (Array.isArray(sources)) return { sources: normaliseSources(sources), migrated: false };
    const folders = Array.isArray(wallpaper?.folders) ? wallpaper.folders : [];
    const legacy = folders.map((folder) => ({ kind: 'folder', location: folder?.path, label: folder?.name, enabled: true }));
    const provider = BUILTIN_PROVIDERS[0];
    legacy.push({ kind: 'online', location: provider.location, label: provider.label, enabled: wallpaper?.online === true });
    return { sources: normaliseSources(legacy), migrated: true };
  }

  /**
   * Projects the sources onto the legacy playback settings, which drive the slide plan:
   * `folders` lists enabled folders only, `online` is true when any online source is enabled.
   * @param {{ folderPath?: string }} wallpaper
   * @param {WallpaperSource[]} sources
   * @returns {{ folders: WallpaperFolder[], online: boolean, folderPath: string }}
   */
  function projectToWallpaper(wallpaper, sources) {
    const folders = sources.filter((source) => source.kind === 'folder' && source.enabled).map((source) => ({ path: source.location, name: source.label }));
    const folderPath = folders.some((folder) => folder.path === wallpaper?.folderPath) ? wallpaper.folderPath : (folders[0]?.path || '');
    return { folders, online: sources.some((source) => source.kind === 'online' && source.enabled), folderPath };
  }

  /**
   * Builds a new source from user input; returns an error string when the input is rejected.
   * @param {'folder' | 'online'} kind
   * @param {string} location
   * @param {string} [label]
   * @returns {{ source: WallpaperSource } | { error: string }}
   */
  function createSource(kind, location, label = '') {
    const source = normaliseSource({ kind, location, label, enabled: true });
    if (!source) return { error: kind === 'online' ? (parseOnlineLocation(location).error || 'Invalid online source') : 'Folder path must be absolute' };
    return { source };
  }

  /** @param {number} bytes */
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const megabytes = bytes / (1024 * 1024);
    if (megabytes < 1) return '<1 MB';
    return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes >= 100 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
  }

  return {
    MAX_SOURCES, MAX_LOCATION_LENGTH, BUILTIN_PROVIDERS, BUILTIN_PREFIX,
    parseOnlineLocation, normaliseSource, normaliseSources, deriveSources, projectToWallpaper, createSource, formatBytes, isPrivateHost
  };
});
