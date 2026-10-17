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

  /**
   * Home section for a tile. Streamed (remote / Moonlight) titles and anything categorised as a game live in
   * "Gaming"; every other website, web app or native application belongs to "Home Theatre".
   * @param {Tile & { category?: string }} tile
   * @returns {'gaming' | 'theatre'}
   */
  function sectionOf(tile) {
    if (tile.category === 'game' || categorise(tile) === 'game') return 'gaming';
    return 'theatre';
  }

  /**
   * Splits a flat tile list into the two home sections. Recently launched tiles lead each section.
   * @param {Tile[]} tiles
   * @param {string[]} recentIds most recent first
   * @param {{ showEmptyGaming?: boolean }} [options] keep the Gaming row (and its host badge) even with no tiles
   * @returns {Layout}
   */
  function buildLayout(tiles, recentIds = [], { showEmptyGaming = false } = {}) {
    const rank = new Map(recentIds.map((id, index) => [id, index]));
    const byRecency = (list) => list
      .map((tile, index) => ({ tile, index, rank: rank.has(tile.id) ? rank.get(tile.id) : Infinity }))
      .sort((left, right) => (left.rank - right.rank) || (left.index - right.index) || 0)
      .map((entry) => entry.tile);
    const buckets = { theatre: [], gaming: [] };
    for (const tile of tiles) buckets[sectionOf(tile)].push(tile);
    const rows = [];
    if (buckets.theatre.length) rows.push({ id: 'theatre', title: 'Home Theatre', tiles: byRecency(buckets.theatre) });
    if (buckets.gaming.length || showEmptyGaming) rows.push({ id: 'gaming', title: 'Gaming', tiles: byRecency(buckets.gaming) });
    return { rows };
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

  return { categorise, sectionOf, buildLayout, pushRecent, subtitle, hueFor, MAX_RECENTS };
});
