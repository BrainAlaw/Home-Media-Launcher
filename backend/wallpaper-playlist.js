'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const MAX_FILES_PER_FOLDER = 5000;
const MAX_DEPTH = 2;
const MAX_FOLDERS = 32;
const SCAN_TTL_MS = 60_000;
const ONLINE_TIMEOUT_MS = 20_000;

/** @param {string} file @returns {'image' | 'video' | null} */
function mediaKind(file) {
  const extension = path.extname(file).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

/**
 * Lists images and videos below `folder` (two levels deep, symlinks ignored), sorted naturally.
 * Never throws for unreadable sub-folders; rejects only when the root itself is not a readable directory.
 * @param {string} folder
 * @returns {Promise<{ path: string, kind: 'image' | 'video' }[]>}
 */
async function scanMediaFolder(folder) {
  const root = await fs.readdir(folder, { withFileTypes: true });
  /** @type {{ path: string, kind: 'image' | 'video' }[]} */
  const found = [];
  async function walk(entries, directory, depth) {
    for (const entry of entries) {
      if (found.length >= MAX_FILES_PER_FOLDER) return;
      const full = path.join(directory, entry.name);
      if (entry.isFile()) {
        const kind = mediaKind(entry.name);
        if (kind) found.push({ path: full, kind });
      } else if (entry.isDirectory() && depth < MAX_DEPTH && !entry.name.startsWith('.')) {
        try { await walk(await fs.readdir(full, { withFileTypes: true }), full, depth + 1); } catch { /* unreadable sub-folder: skipped */ }
      }
    }
  }
  await walk(root, folder, 1);
  return found.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
}

/** @param {unknown} value */
function isAbsolutePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f]/.test(value) && path.isAbsolute(value);
}

/**
 * Main-process slide source for user folders and the optional online catalogue. The renderer only ever
 * names allow-listed folders and a numeric index; files are registered with MediaAssets lazily, one slide at a time.
 */
class WallpaperPlaylist {
  /**
   * @param {{ mediaAssets: { register(source: string, kind: 'image' | 'video'): Promise<string> },
   *   online?: { catalog(): { id: string }[], ensureCached(id: string): Promise<string> } | null,
   *   scan?: (folder: string) => Promise<{ path: string, kind: 'image' | 'video' }[]>, now?: () => number }} options
   */
  constructor({ mediaAssets, online = null, scan = scanMediaFolder, now = Date.now }) {
    this.mediaAssets = mediaAssets;
    this.online = online;
    this.scan = scan;
    this.now = now;
    /** @type {Set<string>} */
    this.allowed = new Set();
    /** Folders switched off in settings.wallpaperSources: never part of a playlist even if a request names them. */
    /** @type {Set<string>} */
    this.disabled = new Set();
    /** @type {Map<string, { at: number, files: { path: string, kind: 'image' | 'video' }[] }>} */
    this.scans = new Map();
  }

  setOnline(online) { this.online = online; }

  /** Replaces the folders the renderer may reference (those saved in the configuration). */
  allow(folders) {
    this.allowed = new Set((folders || []).filter(isAbsolutePath).map((folder) => path.resolve(folder)));
    for (const key of this.scans.keys()) if (!this.allowed.has(key)) this.scans.delete(key);
  }

  /**
   * Applies settings.wallpaperSources: every folder source may be inspected, only enabled ones are played.
   * @param {unknown} sources
   * @param {string[]} [extraFolders] legacy settings.wallpaper.folders, kept allowed for older configurations
   */
  configureSources(sources, extraFolders = []) {
    const folderSources = (Array.isArray(sources) ? sources : []).filter((source) => source && source.kind === 'folder' && isAbsolutePath(source.location));
    this.allow([...extraFolders, ...folderSources.map((source) => source.location)]);
    this.disabled = new Set(folderSources.filter((source) => source.enabled === false).map((source) => path.resolve(source.location)));
  }

  /** Adds a folder just chosen through the native dialog, before the configuration is saved. */
  allowOne(folder) {
    if (!isAbsolutePath(folder)) throw new Error('Folder must be an absolute path');
    this.allowed.add(path.resolve(folder));
  }

  /** @param {unknown} folders @returns {string[]} */
  validateFolders(folders) {
    if (folders === undefined) return [];
    if (!Array.isArray(folders) || folders.length > MAX_FOLDERS) throw new Error('Invalid wallpaper folder list');
    return folders.map((folder) => {
      if (!isAbsolutePath(folder)) throw new Error('Wallpaper folders must be absolute paths');
      const resolved = path.resolve(folder);
      if (!this.allowed.has(resolved)) throw new Error('Unknown wallpaper folder');
      return resolved;
    });
  }

  async files(folder, { force = false } = {}) {
    const cached = this.scans.get(folder);
    if (!force && cached && this.now() - cached.at < SCAN_TTL_MS) return cached.files;
    let files;
    try { files = await this.scan(folder); } catch { files = []; }
    this.scans.set(folder, { at: this.now(), files });
    return files;
  }

  /**
   * Describes a folder for the settings page.
   * @param {unknown} folder
   * @returns {Promise<{ path: string, name: string, images: number, videos: number, total: number, available: boolean }>}
   */
  async inspect(folder) {
    if (!isAbsolutePath(folder)) throw new Error('Folder must be an absolute path');
    const resolved = path.resolve(folder);
    if (!this.allowed.has(resolved)) throw new Error('Unknown wallpaper folder');
    let available = true;
    try { if (!(await fs.stat(resolved)).isDirectory()) available = false; } catch { available = false; }
    const files = available ? await this.files(resolved, { force: true }) : [];
    const images = files.filter((file) => file.kind === 'image').length;
    return { path: resolved, name: path.basename(resolved) || resolved, images, videos: files.length - images, total: files.length, available };
  }

  /** @returns {Promise<({ type: 'file', path: string, kind: 'image' | 'video' } | { type: 'online', id: string })[]>} */
  async items({ folders, online }) {
    const list = [];
    for (const folder of this.validateFolders(folders)) {
      if (this.disabled.has(folder)) continue;
      for (const file of await this.files(folder)) list.push({ type: 'file', path: file.path, kind: file.kind });
    }
    if (online === true && this.online) {
      await this.online.ready?.();
      for (const entry of this.online.catalog()) list.push({ type: 'online', id: entry.id });
    }
    return list;
  }

  /** @param {{ folders?: unknown, online?: unknown }} request */
  async count(request) {
    return { count: (await this.items(this.normalise(request))).length };
  }

  /**
   * Registers and returns exactly one slide. Resolves to null when the file vanished or cannot be fetched,
   * so the renderer can skip it.
   * @param {{ folders?: unknown, online?: unknown }} request
   * @param {unknown} index
   * @returns {Promise<{ url: string, kind: 'image' | 'video', name: string, credit: object | null } | null>}
   */
  async slide(request, index) {
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid wallpaper index');
    const item = (await this.items(this.normalise(request)))[index];
    if (!item) return null;
    try {
      if (item.type === 'file') {
        return { url: await this.mediaAssets.register(item.path, item.kind), kind: item.kind, name: path.basename(item.path), credit: null };
      }
      const cached = await Promise.race([
        this.online.ensureCached(item.id),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), ONLINE_TIMEOUT_MS).unref())
      ]);
      return { url: await this.mediaAssets.register(cached, 'image'), kind: 'image', name: item.id, credit: this.online.credit?.(item.id) ?? null };
    } catch {
      return null;
    }
  }

  /** @param {{ folders?: unknown, online?: unknown } | undefined} request */
  normalise(request) {
    if (!request || typeof request !== 'object') throw new Error('Invalid wallpaper request');
    return { folders: request.folders, online: request.online === true };
  }
}

module.exports = { WallpaperPlaylist, scanMediaFolder, mediaKind, isAbsolutePath };
