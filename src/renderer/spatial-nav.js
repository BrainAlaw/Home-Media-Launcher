(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpatialNav = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @typedef {{ id: string | number, left: number, top: number, right: number, bottom: number }} NavRect
   * @typedef {'up' | 'down' | 'left' | 'right'} Direction
   */

  // Candidates within this many pixels of the nearest edge gap count as the "nearest row/column".
  const BAND_TOLERANCE = { horizontal: 4, vertical: 24 };

  /** @param {NavRect} rect @param {boolean} horizontal */
  function axes(rect, horizontal) {
    return horizontal
      ? { main: [rect.left, rect.right], cross: [rect.top, rect.bottom] }
      : { main: [rect.top, rect.bottom], cross: [rect.left, rect.right] };
  }

  const mid = ([start, end]) => (start + end) / 2;

  /**
   * Picks the best neighbour of `current` in `direction`.
   *
   * Strategy (mirrors TV launchers):
   *  1. Left/right only consider candidates sharing vertical space with the current element (same row).
   *     If none exist, fall back to candidates along the dominant axis.
   *  2. Up/down consider everything strictly above/below.
   *  3. Of the eligible set, keep only the nearest band (closest edge gap), then choose the one whose
   *     centre is closest on the perpendicular axis. This guarantees "down" always lands in the
   *     adjacent row, aligned as closely as possible with the current column.
   *
   * @param {NavRect} current
   * @param {NavRect[]} candidates
   * @param {Direction} direction
   * @returns {string | number | null} id of the best candidate, or null when there is none
   */
  function findNext(current, candidates, direction) {
    const horizontal = direction === 'left' || direction === 'right';
    const forward = direction === 'right' || direction === 'down' ? 1 : -1;
    const from = axes(current, horizontal);

    const measured = [];
    for (const candidate of candidates) {
      if (candidate.id === current.id) continue;
      const to = axes(candidate, horizontal);
      const deltaMain = mid(to.main) - mid(from.main);
      const deltaCross = mid(to.cross) - mid(from.cross);
      if (forward * deltaMain <= 0.5) continue;
      const gap = forward > 0 ? to.main[0] - from.main[1] : from.main[0] - to.main[1];
      const overlap = Math.min(from.cross[1], to.cross[1]) - Math.max(from.cross[0], to.cross[0]);
      measured.push({
        id: candidate.id,
        primary: Math.max(0, gap),
        secondary: Math.abs(deltaCross),
        sameLine: overlap > 0,
        dominant: Math.abs(deltaMain) >= Math.abs(deltaCross)
      });
    }

    let eligible = horizontal ? measured.filter((entry) => entry.sameLine) : measured;
    if (horizontal && !eligible.length) eligible = measured.filter((entry) => entry.dominant);
    if (!eligible.length) return null;

    const nearest = Math.min(...eligible.map((entry) => entry.primary));
    const tolerance = horizontal ? BAND_TOLERANCE.horizontal : BAND_TOLERANCE.vertical;
    const band = eligible.filter((entry) => entry.primary <= nearest + tolerance);
    band.sort((a, b) => a.secondary - b.secondary || a.primary - b.primary);
    return band[0].id;
  }

  /**
   * Snapshot of an element's geometry. Accepts any object exposing getBoundingClientRect().
   * @param {string | number} id
   * @param {{ getBoundingClientRect(): { left: number, top: number, right: number, bottom: number } }} element
   * @returns {NavRect}
   */
  function toRect(id, element) {
    const { left, top, right, bottom } = element.getBoundingClientRect();
    return { id, left, top, right, bottom };
  }

  return { findNext, toRect };
});
