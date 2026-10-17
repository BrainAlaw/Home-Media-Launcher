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
   * @typedef {{ hero: Tile | null, rows: Carousel[] }} Layout
   */

  const MAX_RECENTS = 12;
  const MAX_CONTINUE_ROW = 10;

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
   * Splits a flat tile list into the hero item and ordered carousels.
   * Hero = most recently launched tile, else first Moonlight game, else the first tile.
   * @param {Tile[]} tiles
   * @param {string[]} recentIds most recent first
   * @returns {Layout}
   */
  function buildLayout(tiles, recentIds = []) {
    const byId = new Map(tiles.map((tile) => [tile.id, tile]));
    const recents = recentIds.map((id) => byId.get(id)).filter(Boolean);
    const buckets = { game: [], app: [], web: [] };
    for (const tile of tiles) buckets[categorise(tile)].push(tile);

    const hero = recents[0] || buckets.game[0] || tiles[0] || null;
    const rows = [];
    const continueTiles = recents.slice(1, MAX_CONTINUE_ROW + 1);
    if (continueTiles.length) rows.push({ id: 'recent', title: 'Continue', tiles: continueTiles });
    if (buckets.game.length) rows.push({ id: 'games', title: 'Moonlight Games', tiles: buckets.game });
    if (buckets.app.length) rows.push({ id: 'apps', title: 'Apps', tiles: buckets.app });
    if (buckets.web.length) rows.push({ id: 'web', title: 'Web Apps', tiles: buckets.web });
    return { hero, rows };
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

  return { categorise, buildLayout, pushRecent, subtitle, hueFor, MAX_RECENTS };
});
