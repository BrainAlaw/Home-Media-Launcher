'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('../src/renderer/media-view-model');
const { createMockBridge, PLAYLIST_TOTAL, DETAIL_TRACKS } = require('../src/renderer/media-mock');

const track = { id: '1', uri: 'spotify:track:1', title: 'Song', artists: ['A', 'B'], album: 'Album', artUrl: 'x.png', durationMs: 215000 };

test('duration labels', () => {
  assert.equal(VM.formatDuration(215000), '3:35');
  assert.equal(VM.formatDuration(3723000), '1:02:03');
  assert.equal(VM.formatDuration(undefined), '');
});

test('track and playlist view models', () => {
  const item = VM.trackItem(track);
  assert.equal(item.subtitle, 'A, B · Album');
  assert.equal(item.trackUri, track.uri);
  assert.equal(item.durationLabel, '3:35');
  const playlist = VM.playlistItem({ id: 'p', uri: 'spotify:playlist:p', name: 'Mix', trackCount: 1, owner: 'You' });
  assert.equal(playlist.subtitle, '1 song · You');
  assert.equal(VM.playlistItem({ id: 'q', uri: 'u', name: 'Empty', trackCount: 0 }).subtitle, 'Playlist');
});

test('search result sections skip empty groups and keep order', () => {
  const sections = VM.mapSearchResult({
    tracks: [track], albums: [], playlists: [{ id: 'p', uri: 'u', name: 'P', trackCount: 3 }],
    artists: [{ id: 'r', uri: 'ur', name: 'R' }]
  });
  assert.deepEqual(sections.map((s) => [s.id, s.layout, s.items.length]), [['tracks', 'list', 1], ['playlists', 'rail', 1], ['artists', 'rail', 1]]);
  assert.deepEqual(VM.mapSearchResult(null), []);
});

test('page normalisation handles arrays, totals and null nextOffset', () => {
  assert.deepEqual(VM.normalizePage([1, 2], 0), { items: [1, 2], hasMore: true, nextOffset: 2 });
  assert.equal(VM.normalizePage([], 0).hasMore, false);
  assert.equal(VM.normalizePage({ items: [1], total: 1, offset: 0, nextOffset: null }, 0).hasMore, false);
  const page = VM.normalizePage({ items: new Array(50).fill(0), total: 137, offset: 50, nextOffset: 100 }, 50);
  assert.deepEqual([page.hasMore, page.nextOffset], [true, 100]);
});

test('load-more triggers near the end only once', () => {
  assert.equal(VM.shouldLoadMore({ index: 40, loaded: 50, hasMore: true, loading: false }), true);
  assert.equal(VM.shouldLoadMore({ index: 10, loaded: 50, hasMore: true, loading: false }), false);
  assert.equal(VM.shouldLoadMore({ index: 49, loaded: 50, hasMore: true, loading: true }), false);
  assert.equal(VM.shouldLoadMore({ index: 49, loaded: 50, hasMore: false, loading: false }), false);
});

test('merging pages drops duplicates', () => {
  const merged = VM.mergePage([{ key: 'a' }, { key: 'b' }], [{ key: 'b' }, { key: 'c' }]);
  assert.deepEqual(merged.map((x) => x.key), ['a', 'b', 'c']);
});

test('virtual row range with overscan and clamping', () => {
  assert.deepEqual(VM.visibleRows({ scrollTop: 0, viewportHeight: 500, rowHeight: 100, count: 1000 }), { startRow: 0, endRow: 7 });
  assert.deepEqual(VM.visibleRows({ scrollTop: 5000, viewportHeight: 500, rowHeight: 100, count: 1000 }), { startRow: 48, endRow: 57 });
  assert.deepEqual(VM.visibleRows({ scrollTop: 99800, viewportHeight: 500, rowHeight: 100, count: 1000 }), { startRow: 996, endRow: 1000 });
  assert.deepEqual(VM.visibleRows({ scrollTop: 0, viewportHeight: 500, rowHeight: 100, count: 0 }), { startRow: 0, endRow: 0 });
  const grid = VM.visibleRows({ scrollTop: 0, viewportHeight: 300, rowHeight: 100, count: 25, columns: 4 });
  assert.deepEqual(VM.itemRange(grid, 4, 25), { start: 0, end: 20 });
  assert.equal(VM.itemRange({ startRow: 5, endRow: 7 }, 4, 25).end, 25);
});

test('live node count stays small for a huge list', () => {
  const rows = VM.visibleRows({ scrollTop: 123456, viewportHeight: 900, rowHeight: 80, count: 100000 });
  assert.ok(rows.endRow - rows.startRow <= 16);
});

test('scrollToRow keeps the row in view and clamps', () => {
  const base = { rowHeight: 100, viewportHeight: 500, totalRows: 100, margin: 0.5 };
  assert.equal(VM.scrollToRow({ ...base, row: 3, current: 0 }), 0);
  assert.equal(VM.scrollToRow({ ...base, row: 6, current: 0 }), 250);
  assert.equal(VM.scrollToRow({ ...base, row: 2, current: 400 }), 150);
  assert.equal(VM.scrollToRow({ ...base, row: 99, current: 0 }), 9500);
});

test('scrollToColumn and gridColumns', () => {
  assert.equal(VM.scrollToColumn({ index: 0, itemWidth: 200, gap: 20, viewportWidth: 1000, current: 0, count: 20, padding: 40 }), 0);
  assert.equal(VM.scrollToColumn({ index: 6, itemWidth: 200, gap: 20, viewportWidth: 1000, current: 0, count: 20, padding: 40 }), 40 + 6 * 220 + 200 + 40 - 1000);
  assert.equal(VM.gridColumns(1760, 208, 28), 7);
  assert.equal(VM.gridColumns(100, 208, 28), 1);
});

test('cursor movement: column memory, empty blocks, edges', () => {
  const blocks = [VM.rowBlock(4), VM.rowBlock(0), VM.gridBlock(5, 3), VM.gridBlock(2, 1)];
  assert.deepEqual(VM.firstCursor(blocks), { block: 0, row: 0, col: 0 });
  assert.deepEqual(VM.moveCursor(blocks, { block: 0, row: 0, col: 3 }, 'down', 3), { block: 2, row: 0, col: 2 });
  assert.deepEqual(VM.moveCursor(blocks, { block: 2, row: 0, col: 2 }, 'down', 2), { block: 2, row: 1, col: 1 });
  assert.deepEqual(VM.moveCursor(blocks, { block: 2, row: 1, col: 1 }, 'down', 2), { block: 3, row: 0, col: 0 });
  assert.equal(VM.moveCursor(blocks, { block: 3, row: 1, col: 0 }, 'down', 0), null);
  assert.deepEqual(VM.moveCursor(blocks, { block: 2, row: 0, col: 0 }, 'up', 0), { block: 0, row: 0, col: 0 });
  assert.equal(VM.moveCursor(blocks, { block: 2, row: 1, col: 1 }, 'right', 1), null);
  assert.deepEqual(VM.moveCursor(blocks, { block: 2, row: 0, col: 0 }, 'right', 0), { block: 2, row: 0, col: 1 });
});

test('screens and error wording', () => {
  assert.equal(VM.screenFor({ status: 'signed-in', displayName: 'x' }), 'ready');
  assert.equal(VM.screenFor({ status: 'unconfigured' }), 'unconfigured');
  assert.equal(VM.screenFor(undefined), 'signed-out');
  assert.equal(VM.describeError({ code: 'PREMIUM_REQUIRED', message: 'x' }).kind, 'premium');
  assert.equal(VM.describeError({ code: 'RATE_LIMITED', message: 'x' }).kind, 'rate-limit');
  assert.equal(VM.describeError({ code: 'NO_ACTIVE_DEVICE', message: 'x' }).action, 'devices');
  assert.equal(VM.describeError({ code: 'AUTH', message: 'x' }).action, 'sign-in');
  assert.equal(VM.describeError({ code: 'OFFLINE', message: 'x' }).kind, 'offline');
  assert.equal(VM.describeError(new Error('boom')).kind, 'generic');
  assert.equal(VM.isTracksUnavailable({ code: 'HTTP_403' }), true);
  assert.equal(VM.isTracksUnavailable({ code: 'OFFLINE' }), false);
});

test('mock bridge follows the ns media envelopes', async () => {
  const bridge = createMockBridge({ latency: 0 });
  const search = await bridge.invoke('search', 'glass');
  assert.equal(search.ok, true);
  assert.equal(search.results.tracks.length, 10);
  const first = await bridge.invoke('playlists', 0);
  assert.equal(first.items.length, 50);
  assert.equal(first.nextOffset, 50);
  const last = await bridge.invoke('playlists', 100);
  assert.equal(last.items.length, PLAYLIST_TOTAL - 100);
  assert.equal(last.nextOffset, null);
  assert.equal((await bridge.invoke('playlistTracks', 'p1', 100)).items.length, DETAIL_TRACKS - 100);
  const premium = createMockBridge({ scenario: 'premium', latency: 0 });
  assert.deepEqual(await premium.invoke('play', {}), { ok: false, error: 'Spotify Premium required', code: 'PREMIUM_REQUIRED' });
});
