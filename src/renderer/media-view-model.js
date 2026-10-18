(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MediaViewModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Pure helpers for the music view: contract -> view-model mapping, paging, virtualisation ranges, grid navigation
   * and error wording. No DOM access, so everything here is unit tested.
   *
   * @typedef {{ key: string, kind: 'track'|'album'|'playlist'|'artist', uri: string, title: string, subtitle: string,
   *   artUrl?: string, durationLabel?: string, trackUri?: string }} ViewItem
   * @typedef {{ id: 'tracks'|'albums'|'playlists'|'artists', title: string, layout: 'list'|'rail', items: ViewItem[] }} ViewSection
   */

  const PLAYLIST_PAGE_FALLBACK = 50;
  const LOAD_MORE_THRESHOLD = 12;

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const total = Math.round(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  /** @param {import('../../backend/contracts').MediaTrack} track @returns {ViewItem} */
  function trackItem(track) {
    const artists = Array.isArray(track.artists) ? track.artists.filter(Boolean).join(', ') : '';
    return {
      key: `track:${track.uri || track.id}`,
      kind: 'track',
      uri: track.uri,
      trackUri: track.uri,
      title: track.title || 'Unknown track',
      subtitle: [artists, track.album].filter(Boolean).join(' · '),
      artUrl: track.artUrl,
      durationLabel: formatDuration(track.durationMs)
    };
  }

  const albumItem = (album) => ({ key: `album:${album.uri || album.id}`, kind: 'album', uri: album.uri, title: album.name || 'Album', subtitle: album.artist || 'Album', artUrl: album.artUrl });
  const artistItem = (artist) => ({ key: `artist:${artist.uri || artist.id}`, kind: 'artist', uri: artist.uri, title: artist.name || 'Artist', subtitle: 'Artist', artUrl: artist.artUrl });
  const playlistItem = (playlist) => ({
    key: `playlist:${playlist.uri || playlist.id}`,
    kind: 'playlist',
    uri: playlist.uri,
    id: playlist.id,
    title: playlist.name || 'Playlist',
    subtitle: [playlist.trackCount > 0 ? `${playlist.trackCount} ${playlist.trackCount === 1 ? 'song' : 'songs'}` : '', playlist.owner].filter(Boolean).join(' · ') || 'Playlist',
    artUrl: playlist.artUrl
  });

  /**
   * Maps a search result to ordered, non-empty sections.
   * @param {import('../../backend/contracts').MediaSearchResult | null | undefined} result
   * @returns {ViewSection[]}
   */
  function mapSearchResult(result) {
    if (!result) return [];
    const sections = [
      { id: 'tracks', title: 'Songs', layout: 'list', items: (result.tracks || []).map(trackItem) },
      { id: 'albums', title: 'Albums', layout: 'rail', items: (result.albums || []).map(albumItem) },
      { id: 'playlists', title: 'Playlists', layout: 'rail', items: (result.playlists || []).map(playlistItem) },
      { id: 'artists', title: 'Artists', layout: 'rail', items: (result.artists || []).map(artistItem) }
    ];
    return sections.filter((section) => section.items.length > 0);
  }

  /**
   * Maps the "For you" shelves to ordered, non-empty rail sections. Spotify-owned playlists play directly
   * (their track lists are not readable through the Web API), so they carry `direct: true`.
   * @returns {ViewSection[]}
   */
  function mapForYouResult(result) {
    if (!result) return [];
    const sections = [
      { id: 'made', title: 'Made for you', layout: 'rail', items: (result.madeForYou || []).map((playlist) => ({ ...playlistItem(playlist), direct: true, subtitle: 'Made for you' })) },
      { id: 'recent', title: 'Recently played', layout: 'rail', items: (result.recent || []).map(trackItem) },
      { id: 'top', title: 'Your top songs', layout: 'rail', items: (result.topTracks || []).map(trackItem) },
      { id: 'saved', title: 'Your albums', layout: 'rail', items: (result.albums || []).map(albumItem) },
      { id: 'artists', title: 'Your top artists', layout: 'rail', items: (result.topArtists || []).map(artistItem) },
      { id: 'new', title: 'New releases', layout: 'rail', items: (result.newReleases || []).map(albumItem) }
    ];
    return sections.filter((section) => section.items.length > 0);
  }

  /**
   * Normalises a paged response: either a bare array or `{ items, total?, next?, nextOffset? }`.
   * Without a total, a non-empty page is assumed to have a successor (the first empty page ends the list).
   * @returns {{ items: any[], hasMore: boolean, nextOffset: number }}
   */
  function normalizePage(response, offset = 0) {
    const items = Array.isArray(response) ? response : Array.isArray(response?.items) ? response.items : [];
    const nextOffset = Number.isFinite(response?.nextOffset) ? response.nextOffset : offset + items.length;
    let hasMore = items.length > 0;
    if (response && !Array.isArray(response)) {
      if (typeof response.hasMore === 'boolean') hasMore = response.hasMore && items.length > 0;
      else if (Number.isFinite(response.total)) hasMore = nextOffset < response.total && items.length > 0;
      else if (response.next === null) hasMore = false;
      if (response.nextOffset === null) hasMore = false;
    }
    return { items, hasMore, nextOffset };
  }

  /** True when the focused index is close enough to the end of the loaded items to request the next page. */
  function shouldLoadMore({ index, loaded, hasMore, loading, threshold = LOAD_MORE_THRESHOLD }) {
    return Boolean(hasMore) && !loading && loaded > 0 && index >= loaded - threshold;
  }

  /** Appends a page without duplicating keys already present (Spotify can shift items between pages). */
  function mergePage(existing, incoming, keyOf = (item) => item.key) {
    const seen = new Set(existing.map(keyOf));
    const merged = existing.slice();
    for (const item of incoming) {
      const key = keyOf(item);
      if (!seen.has(key)) { seen.add(key); merged.push(item); }
    }
    return merged;
  }

  /* ---------------------------------------------------------------- virtualisation */

  const rowCount = (count, columns) => (count > 0 ? Math.ceil(count / Math.max(1, columns)) : 0);

  /**
   * Visible row interval [startRow, endRow) for a vertically scrolled grid; `overscan` rows are kept on both sides.
   */
  function visibleRows({ scrollTop, viewportHeight, rowHeight, count, columns = 1, overscan = 2 }) {
    const rows = rowCount(count, columns);
    if (rows === 0 || rowHeight <= 0 || viewportHeight <= 0) return { startRow: 0, endRow: 0 };
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endRow = Math.min(rows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
    return { startRow, endRow: Math.max(startRow, endRow) };
  }

  /** Item index interval [start, end) covered by a row interval. */
  function itemRange(rows, columns, count) {
    return { start: Math.min(count, rows.startRow * columns), end: Math.min(count, rows.endRow * columns) };
  }

  /** Scroll offset that keeps `row` fully visible with `margin` rows of context; returns `current` when already visible. */
  function scrollToRow({ row, rowHeight, viewportHeight, current, totalRows, margin = 0.5 }) {
    const maxScroll = Math.max(0, totalRows * rowHeight - viewportHeight);
    const top = row * rowHeight - margin * rowHeight;
    const bottom = (row + 1) * rowHeight + margin * rowHeight - viewportHeight;
    let target = current;
    if (top < current) target = top;
    else if (bottom > current) target = bottom;
    return Math.min(maxScroll, Math.max(0, target));
  }

  /** Horizontal equivalent for rails: translation (<= 0 offset is applied by the caller) that keeps `index` visible. */
  function scrollToColumn({ index, itemWidth, gap, viewportWidth, current, count, padding = 0 }) {
    const pitch = itemWidth + gap;
    const contentWidth = padding * 2 + count * pitch - gap;
    const maxScroll = Math.max(0, contentWidth - viewportWidth);
    const left = padding + index * pitch - padding;
    const right = padding + index * pitch + itemWidth + padding - viewportWidth;
    let target = current;
    if (left < current) target = left;
    else if (right > current) target = right;
    return Math.min(maxScroll, Math.max(0, target));
  }

  /** Columns that fit a viewport for fixed-width tiles. */
  function gridColumns(viewportWidth, itemWidth, gap) {
    return Math.max(1, Math.floor((viewportWidth + gap) / (itemWidth + gap)));
  }

  /* ---------------------------------------------------------------- focus navigation across blocks */

  /**
   * Block layout used by the focus controller.
   * @typedef {{ rows: number, cols: (row: number) => number }} Block
   * @typedef {{ block: number, row: number, col: number }} Cursor
   */

  /** Block with a single row of `count` focusables. */
  const rowBlock = (count) => ({ rows: count > 0 ? 1 : 0, cols: () => count });
  /** Block that lays `count` items into `columns` columns (columns = 1 gives a vertical list). */
  const gridBlock = (count, columns) => ({ rows: rowCount(count, columns), cols: (row) => Math.max(0, Math.min(columns, count - row * columns)) });

  /**
   * One d-pad step through stacked blocks. Returns null at an edge. `preferredCol` is the remembered column used when
   * entering a row with a different length (column memory).
   * @param {Block[]} blocks @param {Cursor} cursor @param {'up'|'down'|'left'|'right'} direction @param {number} preferredCol
   * @returns {Cursor | null}
   */
  function moveCursor(blocks, cursor, direction, preferredCol) {
    const { block, row, col } = cursor;
    if (direction === 'left' || direction === 'right') {
      const next = col + (direction === 'right' ? 1 : -1);
      return next >= 0 && next < blocks[block].cols(row) ? { block, row, col: next } : null;
    }
    const step = direction === 'down' ? 1 : -1;
    let b = block;
    let r = row + step;
    for (;;) {
      while (r < 0 || r >= blocks[b].rows) {
        b += step;
        if (b < 0 || b >= blocks.length) return null;
        r = step > 0 ? 0 : blocks[b].rows - 1;
      }
      const cols = blocks[b].cols(r);
      if (cols > 0) return { block: b, row: r, col: Math.min(Math.max(0, preferredCol), cols - 1) };
      r += step;
    }
  }

  /** First valid cursor at or after `block` (blocks may be empty). */
  function firstCursor(blocks, block = 0) {
    for (let index = Math.max(0, block); index < blocks.length; index++) {
      if (blocks[index].rows > 0 && blocks[index].cols(0) > 0) return { block: index, row: 0, col: 0 };
    }
    return null;
  }

  /* ---------------------------------------------------------------- state / errors */

  /**
   * Which top-level screen the view shows for an auth state.
   * @returns {'ready'|'unconfigured'|'signed-out'|'signing-in'|'error'}
   */
  function screenFor(auth) {
    switch (auth?.status) {
      case 'signed-in': return 'ready';
      case 'unconfigured': return 'unconfigured';
      case 'signing-in': return 'signing-in';
      case 'error': return 'error';
      default: return 'signed-out';
    }
  }

  /**
   * Wording for a failed ext call. `action` is a hint for the primary call-to-action.
   * @returns {{ message: string, kind: 'premium'|'rate-limit'|'no-device'|'offline'|'auth'|'generic', action: 'none'|'devices'|'sign-in'|'retry' }}
   */
  function describeError(error) {
    const raw = `${error?.code ?? ''} ${error?.message ?? error ?? ''}`.trim();
    if (/premium/i.test(raw)) return { kind: 'premium', action: 'none', message: 'Spotify Premium is required to control playback from here.' };
    if (/rate.?limit|429|too many/i.test(raw)) return { kind: 'rate-limit', action: 'retry', message: 'Spotify is rate limiting requests. Try again in a moment.' };
    if (/no.?active.?device|no.?device|device.?not.?found|404/i.test(raw)) return { kind: 'no-device', action: 'devices', message: 'No playback device is active. Choose a device.' };
    if (/\bAUTH\b|UNCONFIGURED|sign.?in|signed.?out|unauthor|401|token/i.test(raw)) return { kind: 'auth', action: 'sign-in', message: 'Spotify needs you to sign in again.' };
    if (/network|offline|ENOTFOUND|ECONN|ETIMEDOUT|fetch failed/i.test(raw)) return { kind: 'offline', action: 'retry', message: 'Spotify cannot be reached. Check the network connection.' };
    return { kind: 'generic', action: 'retry', message: raw ? `Spotify error: ${raw.replace(/^Error:\s*/i, '').slice(0, 140)}` : 'Something went wrong with Spotify.' };
  }

  /** True for errors that mean "Spotify does not expose this playlist's tracks" (not owned / collaborative). */
  function isTracksUnavailable(error) {
    return /HTTP_403|HTTP_404|INVALID/i.test(`${error?.code ?? ''} ${error?.message ?? ''}`);
  }

  /** Mini-bar text for the playback state. */
  function nowPlayingText(state) {
    if (!state?.track) return { title: state?.idle === false ? 'Nothing playing' : 'Nothing playing', subtitle: state?.device ? state.device.name : 'Choose a device to start' };
    return { title: state.track.title, subtitle: (state.track.artists || []).join(', ') };
  }

  return {
    PLAYLIST_PAGE_FALLBACK, LOAD_MORE_THRESHOLD,
    formatDuration, trackItem, albumItem, artistItem, playlistItem, mapSearchResult, mapForYouResult,
    normalizePage, shouldLoadMore, mergePage,
    rowCount, visibleRows, itemRange, scrollToRow, scrollToColumn, gridColumns,
    rowBlock, gridBlock, moveCursor, firstCursor,
    screenFor, describeError, isTracksUnavailable, nowPlayingText
  };
});
