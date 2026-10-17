(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IconPopupModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Categories used when settings.categories is missing or unusable. */
  const DEFAULT_CATEGORIES = Object.freeze([
    Object.freeze({ id: 'theatre', label: 'Home Theatre' }),
    Object.freeze({ id: 'gaming', label: 'Gaming' })
  ]);
  const DEFAULT_CATEGORY_ID = 'theatre';
  const MAX_CANDIDATES = 12;

  /**
   * Reads settings.categories defensively: entries need a non-empty string id, duplicates are dropped and a missing
   * label falls back to the id. Anything unusable yields the two default categories.
   * @param {unknown} settings
   * @returns {{ id: string, label: string }[]}
   */
  function readCategories(settings) {
    const list = settings && typeof settings === 'object' ? settings.categories : undefined;
    if (!Array.isArray(list)) return DEFAULT_CATEGORIES.map((entry) => ({ ...entry }));
    const seen = new Set();
    const result = [];
    for (const entry of list) {
      const id = entry && typeof entry.id === 'string' ? entry.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      result.push({ id, label: typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id });
    }
    return result.length ? result : DEFAULT_CATEGORIES.map((entry) => ({ ...entry }));
  }

  /**
   * Category options for one website. A stored id that is no longer in the list is kept as an extra option so that
   * saving never silently moves the site; a missing id means Home Theatre.
   * @param {{ id: string, label: string }[]} categories
   * @param {unknown} value stored `category` of the website
   * @returns {{ selected: string, options: { id: string, label: string }[] }}
   */
  function categoryChoices(categories, value) {
    const stored = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_CATEGORY_ID;
    const options = categories.map((entry) => ({ ...entry }));
    if (!options.some((entry) => entry.id === stored)) options.push({ id: stored, label: stored });
    return { selected: stored, options };
  }

  /**
   * Normalises an `icons.searchArtwork` result into thumbnails for the candidate grid. Accepts an array or
   * `{ results }`, strings or candidate objects; `url` is what gets stored, `thumb` only drives the preview.
   * @param {unknown} result
   * @returns {{ url: string, thumb: string, label: string }[]}
   */
  function normaliseCandidates(result) {
    const list = Array.isArray(result) ? result : (result && Array.isArray(result.results) ? result.results : []);
    const seen = new Set();
    const candidates = [];
    for (const item of list) {
      const url = typeof item === 'string' ? item : item && item.url;
      if (typeof url !== 'string' || !url || seen.has(url)) continue;
      seen.add(url);
      const thumb = item && typeof item === 'object' && typeof item.thumb === 'string' && item.thumb ? item.thumb : url;
      const size = item && typeof item === 'object' && item.width && item.height ? `${item.width}×${item.height}` : '';
      const name = item && typeof item === 'object' && typeof item.gameName === 'string' ? item.gameName : '';
      candidates.push({ url, thumb, label: [name, size].filter(Boolean).join(' · ') || 'Artwork' });
      if (candidates.length >= MAX_CANDIDATES) break;
    }
    return candidates;
  }

  /** Artwork kind to search for: apps and websites want square icons, games want posters. */
  function artKindFor(kind) { return kind === 'game' ? 'poster' : 'icon'; }

  /** First letter shown while an item has no loadable icon. */
  function initialOf(name) { return (String(name || '').trim().charAt(0) || '?').toUpperCase(); }

  return { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_ID, MAX_CANDIDATES, readCategories, categoryChoices, normaliseCandidates, artKindFor, initialOf };
});
