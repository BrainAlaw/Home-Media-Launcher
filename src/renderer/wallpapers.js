(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Wallpapers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @typedef {{ id: string, name: string, file: string, thumb: string, license: string, author: string, source: string }} WallpaperEntry
   * @typedef {{ path: string, name: string }} WallpaperFolder
   * @typedef {'bundled' | 'folder' | 'online' | 'mixed'} SlideshowSource
   * @typedef {{ mode: 'custom' | 'bundled' | 'slideshow', id: string, intervalSec: number, source: SlideshowSource,
   *   folderPath: string, folders: WallpaperFolder[], shuffle: boolean, online: boolean }} WallpaperSettings
   * @typedef {{ bundled: boolean, folders: string[], online: boolean }} SlidePlan
   */

  const MODES = Object.freeze(['custom', 'bundled', 'slideshow']);
  const INTERVALS = Object.freeze([
    { seconds: 30, label: '30 s' },
    { seconds: 60, label: '1 min' },
    { seconds: 300, label: '5 min' },
    { seconds: 900, label: '15 min' }
  ]);
  const DEFAULT_INTERVAL = 300;
  const SOURCES = Object.freeze(['bundled', 'folder', 'online', 'mixed']);
  const MAX_FOLDERS = 32;

  /**
   * Keeps only well-formed, de-duplicated folder entries (absolute path + display name).
   * @param {unknown} folders
   * @returns {WallpaperFolder[]}
   */
  function normaliseFolders(folders) {
    if (!Array.isArray(folders)) return [];
    const seen = new Set();
    const result = [];
    for (const folder of folders) {
      const folderPath = folder && typeof folder.path === 'string' ? folder.path : '';
      if (!folderPath || seen.has(folderPath) || !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(folderPath)) continue;
      seen.add(folderPath);
      const fallback = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
      result.push({ path: folderPath, name: typeof folder.name === 'string' && folder.name.trim() ? folder.name.trim().slice(0, 80) : fallback });
      if (result.length >= MAX_FOLDERS) break;
    }
    return result;
  }

  /**
   * Which slide pools the current settings draw from. Missing folders or a disabled online toggle
   * degrade to the bundled gallery so the slideshow is never empty by configuration alone.
   * @param {WallpaperSettings} settings
   * @returns {SlidePlan}
   */
  function slidePlan(settings) {
    const all = settings.folders.map((folder) => folder.path);
    const plan = { bundled: false, folders: [], online: false };
    if (settings.source === 'bundled') plan.bundled = true;
    else if (settings.source === 'folder') plan.folders = all.includes(settings.folderPath) ? [settings.folderPath] : all.slice(0, 1);
    else if (settings.source === 'online') plan.online = settings.online;
    else Object.assign(plan, { bundled: true, folders: all, online: settings.online });
    if (!plan.bundled && !plan.folders.length && !plan.online) plan.bundled = true;
    return plan;
  }

  /**
   * Playback order for `count` slides: identity, or a random permutation when `shuffle` is set.
   * @param {number} count
   * @param {boolean} shuffleOn
   * @param {() => number} [random]
   * @returns {number[]}
   */
  function playbackOrder(count, shuffleOn, random = Math.random) {
    const indexes = Array.from({ length: Math.max(0, count) }, (_unused, index) => index);
    return shuffleOn ? shuffle(indexes, random) : indexes;
  }

  /**
   * Fisher-Yates shuffle returning a new array; `random` is injectable for tests.
   * @template T
   * @param {T[]} items
   * @param {() => number} [random]
   * @returns {T[]}
   */
  function shuffle(items, random = Math.random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Gallery bound to the bundled wallpaper list (window.WALLPAPER_ENTRIES in the renderer).
   * @param {WallpaperEntry[]} entries
   */
  function createGallery(entries) {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));

    /**
     * Normalises persisted settings: a missing mode uses `defaultMode` (slideshow: on by default), unknown modes fall back to "custom" (the user's own file),
     * unknown ids to the first bundled entry, unknown intervals to the default.
     * @param {Partial<WallpaperSettings> | undefined} settings
     * @param {'custom' | 'bundled' | 'slideshow'} [defaultMode]
     * @returns {WallpaperSettings}
     */
    function resolve(settings = {}, defaultMode = 'slideshow') {
      const requested = settings?.mode === undefined ? defaultMode : settings.mode;
      const mode = entries.length && MODES.includes(requested) ? requested : 'custom';
      settings = settings || {};
      const id = byId.has(settings.id) ? settings.id : (entries[0]?.id || '');
      const intervalSec = INTERVALS.some((option) => option.seconds === settings.intervalSec) ? settings.intervalSec : DEFAULT_INTERVAL;
      const folders = normaliseFolders(settings.folders);
      const source = SOURCES.includes(settings.source) ? settings.source : 'bundled';
      const folderPath = folders.some((folder) => folder.path === settings.folderPath) ? settings.folderPath : (folders[0]?.path || '');
      return { mode, id, intervalSec, source, folderPath, folders, shuffle: settings.shuffle !== false, online: settings.online === true };
    }

    /**
     * Resolves a bundled entry to an absolute URL relative to the page.
     * @param {WallpaperEntry} entry
     * @param {string} baseUri document.baseURI
     * @param {'file' | 'thumb'} [kind]
     */
    function urlFor(entry, baseUri, kind = 'file') {
      return new URL(entry[kind], baseUri).href;
    }

    /**
     * Next slide index; never repeats the current one when more than one slide exists.
     * @param {number} current
     * @param {number} count
     */
    function nextIndex(current, count) {
      return count > 0 ? (current + 1) % count : 0;
    }

    return { entries, get: (id) => byId.get(id), resolve, urlFor, nextIndex };
  }

  return { MODES, SOURCES, INTERVALS, DEFAULT_INTERVAL, shuffle, normaliseFolders, slidePlan, playbackOrder, createGallery };
});
