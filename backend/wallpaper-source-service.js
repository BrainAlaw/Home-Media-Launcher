'use strict';

const { deriveSources, normaliseSources, parseOnlineLocation } = require('../src/renderer/wallpaper-sources');

/**
 * Main-process glue for settings.wallpaperSources: applies the saved list to the playlist and the online
 * catalogue loader, and answers the settings page ("inspect", "probe", "clearCache").
 * Nothing here trusts the renderer: sources are re-normalised, only https catalogues on public hosts are fetched.
 */
class WallpaperSourceService {
  /**
   * @param {{ playlist: import('./wallpaper-playlist').WallpaperPlaylist,
   *   online?: import('./online-wallpapers').OnlineWallpapers | null }} options
   */
  constructor({ playlist, online = null }) {
    this.playlist = playlist;
    this.online = online;
  }

  /** Applies `config.settings`; call whenever the configuration is (re)loaded. */
  apply(settings) {
    const legacyFolders = (settings?.wallpaper?.folders || []).map((folder) => folder.path);
    const { sources, migrated } = deriveSources(settings?.wallpaper, settings?.wallpaperSources);
    // Never-saved configurations keep the legacy behaviour: all folders on, built-in catalogue gated by wallpaper.online.
    this.playlist.configureSources(migrated ? [] : sources, legacyFolders);
    this.online?.setSources(migrated ? null : sources);
    return sources;
  }

  /**
   * @param {unknown} action 'inspect' | 'probe' | 'clearCache'
   * @param {any} payload
   */
  async handle(action, payload) {
    if (action === 'inspect') return this.inspect(payload?.sources);
    if (action === 'probe') return this.probe(payload?.location);
    if (action === 'clearCache') {
      const removed = this.online ? await this.online.clear() : 0;
      return { removed };
    }
    throw new Error('Unknown wallpaper source action');
  }

  async inspect(rawSources) {
    const sources = normaliseSources(rawSources);
    const infos = await Promise.all(sources.map((source) => (source.kind === 'folder' ? this.inspectFolder(source) : this.inspectOnline(source))));
    let cacheBytes = 0;
    if (this.online) for (const item of await this.online.listCache()) cacheBytes += item.size;
    return { sources: infos, cacheBytes, onlineAvailable: Boolean(this.online) };
  }

  async inspectFolder(source) {
    try {
      const info = await this.playlist.inspect(source.location);
      return { id: source.id, kind: 'folder', count: info.total, images: info.images, videos: info.videos, available: info.available, cacheBytes: 0, error: info.available ? '' : 'Folder not found' };
    } catch (error) {
      return { id: source.id, kind: 'folder', count: 0, images: 0, videos: 0, available: false, cacheBytes: 0, error: error.message };
    }
  }

  async inspectOnline(source) {
    const parsed = parseOnlineLocation(source.location);
    const base = { id: source.id, kind: 'online', host: parsed.ok ? parsed.host : '' };
    if (!this.online) return { ...base, count: 0, available: false, cacheBytes: 0, error: 'Online wallpapers are not available in this build' };
    return { ...base, ...(await this.online.stats(source.location)) };
  }

  /** Fetches and validates a catalogue before the user adds it. */
  async probe(location) {
    const parsed = parseOnlineLocation(location);
    if (!parsed.ok) return { ok: false, error: parsed.error, count: 0, name: '', location: '' };
    if (!this.online) return { ok: false, error: 'Online wallpapers are not available in this build', count: 0, name: '', location: parsed.location };
    return { ...(await this.online.probe(parsed.location)), location: parsed.location };
  }
}

module.exports = { WallpaperSourceService };
