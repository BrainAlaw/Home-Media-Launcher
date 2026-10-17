(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TileModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @typedef {{
   *   id: string, name: string, icon?: string, background?: string, command?: string,
   *   provider?: 'local' | 'remote', type?: string, url?: string, remote?: boolean
   * }} Tile
   * @typedef {{ id: string, title: string, tiles: Tile[] }} Carousel
   * @typedef {{ rows: Carousel[] }} Layout
   */

  const MAX_RECENTS = 12;
  
  const baseName = (path) => String(path || '').split(/[\\/]/).pop().toLowerCase();

  /**
   * Buckets a tile into a carousel category.
   * Remote (VibePollo / Sunshine) apps and anything launched through Moonlight are "game"; websites are "web".
   * @param {Tile} tile
   * @returns {'game' | 'app' | 'web'}
   */
  function categorise(tile) {
    if (tile.type === 'website') return 'web';
    if (tile.provider === 'remote' || tile.remote || /moonlight/.test(baseName(tile.command))) return 'game';
    return 'app';
  }

  /** @typedef {{ id: string, label: string, builtin?: 'theatre' | 'gaming' }} Category */

  /** Categories used when settings.categories is missing or unusable. Ids `theatre` and `gaming` are stable. */
  const DEFAULT_CATEGORIES = Object.freeze([
    Object.freeze({ id: 'theatre', label: 'Home Theatre', builtin: 'theatre' }),
    Object.freeze({ id: 'gaming', label: 'Gaming', builtin: 'gaming' })
  ]);

  /**
   * Cleans settings.categories: drops malformed entries and duplicate ids, trims labels. Falls back to the defaults
   * when nothing valid remains.
   * @param {unknown} list
   * @returns {Category[]}
   */
  function normaliseCategories(list) {
    const seen = new Set();
    const result = [];
    for (const entry of Array.isArray(list) ? list : []) {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : id;
      result.push({ id, label, ...(entry.builtin === 'theatre' || entry.builtin === 'gaming' ? { builtin: entry.builtin } : {}) });
    }
    return result.length ? result : DEFAULT_CATEGORIES.map((category) => ({ ...category }));
  }

  /**
   * Category id that receives tiles of a type when they carry no (or an unknown) category: the builtin category
   * of that kind, else the id of the same name, else the last category for gaming / the first for everything else.
   * @param {Category[]} categories normalised, non-empty
   * @param {'gaming' | 'theatre'} kind
   * @returns {string}
   */
  function defaultCategoryId(categories, kind) {
    const match = categories.find((category) => category.builtin === kind) || categories.find((category) => category.id === kind);
    if (match) return match.id;
    return (kind === 'gaming' ? categories[categories.length - 1] : categories[0]).id;
  }

  /**
   * Row (category) id for a tile. A known `tile.category` wins. Streamed (remote / Moonlight) titles and the legacy
   * `game` category default to the gaming category; everything else defaults to the theatre category. Unknown or
   * deleted ids fall back to that default.
   * @param {Tile & { category?: string }} tile
   * @param {Category[]} [categories]
   * @returns {string}
   */
  function sectionOf(tile, categories) {
    const list = normaliseCategories(categories);
    const own = typeof tile.category === 'string' ? tile.category : '';
    if (own && list.some((category) => category.id === own)) return own;
    const isGame = own === 'game' || categorise(tile) === 'game';
    return defaultCategoryId(list, isGame ? 'gaming' : 'theatre');
  }

  /**
   * Splits a flat tile list into one row per category, in category order (top to bottom). Recently launched tiles
   * lead each row. Empty rows are skipped, except the gaming category with `showEmptyGaming`.
   * @param {Tile[]} tiles
   * @param {string[]} recentIds most recent first
   * @param {{ showEmptyGaming?: boolean, gamingEmptyMessage?: string, categories?: Category[] }} [options]
   *   `showEmptyGaming` keeps the Gaming row (and its host badge) even with no tiles; the message explains the empty row
   * @returns {Layout}
   */
  function buildLayout(tiles, recentIds = [], { showEmptyGaming = false, gamingEmptyMessage = '', categories } = {}) {
    const list = normaliseCategories(categories);
    const rank = new Map(recentIds.map((id, index) => [id, index]));
    const byRecency = (items) => items
      .map((tile, index) => ({ tile, index, rank: rank.has(tile.id) ? rank.get(tile.id) : Infinity }))
      .sort((left, right) => (left.rank - right.rank) || (left.index - right.index) || 0)
      .map((entry) => entry.tile);
    const buckets = new Map(list.map((category) => [category.id, []]));
    for (const tile of tiles) buckets.get(sectionOf(tile, list)).push(tile);
    const gamingId = defaultCategoryId(list, 'gaming');
    const rows = [];
    for (const category of list) {
      const members = buckets.get(category.id);
      const keepEmpty = showEmptyGaming && category.id === gamingId && (category.builtin === 'gaming' || category.id === 'gaming');
      if (!members.length && !keepEmpty) continue;
      rows.push({
        id: category.id,
        title: category.label,
        tiles: byRecency(members),
        ...(!members.length && gamingEmptyMessage ? { emptyMessage: gamingEmptyMessage } : {})
      });
    }
    return { rows };
  }

  /**
   * Explains an empty Gaming row from the remote sync result.
   * @param {{ status?: string, host?: string, error?: string } | undefined} remoteStatus
   * @param {{ enabled?: boolean, host?: string } | undefined} remote
   * @param {number} [hiddenCount] remote apps the user switched off in Settings
   * @returns {string}
   */
  function describeEmptyGaming(remoteStatus, remote, hiddenCount = 0) {
    if (!remote?.enabled) return '';
    const host = remote.host || remoteStatus?.host || 'the host';
    const status = remoteStatus?.status;
    if (status === 'offline') {
      return /credential|token|unauthori[sz]ed|401|403/i.test(remoteStatus?.error || '')
        ? `No apps yet - check the API token for ${host}`
        : `Offline - no cached apps yet. Check that ${host} is reachable`;
    }
    if (hiddenCount > 0) return 'All apps are hidden - re-enable them in Settings > Applications';
    return `No apps yet - ${host} reports no applications`;
  }

  /**
   * Returns a new recents list with `id` moved to the front.
   * @param {string[]} ids
   * @param {string} id
   * @param {number} [max]
   * @returns {string[]}
   */
  function pushRecent(ids, id, max = MAX_RECENTS) {
    return [id, ...ids.filter((existing) => existing !== id)].slice(0, max);
  }

  /** @param {Tile} tile */
  function subtitle(tile) {
    if (tile.type === 'website') {
      try { return new URL(tile.url).hostname.replace(/^www\./, ''); } catch { return 'Web app'; }
    }
    const labels = { game: 'Moonlight', app: 'Application' };
    return labels[categorise(tile)];
  }

  /**
   * Stable hue (0-359) derived from a name, used for generated fallback artwork.
   * @param {string} name
   */
  function hueFor(name) {
    let hash = 0;
    for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return hash % 360;
  }

  return { categorise, sectionOf, buildLayout, normaliseCategories, defaultCategoryId, DEFAULT_CATEGORIES, describeEmptyGaming, pushRecent, subtitle, hueFor, MAX_RECENTS };
});
