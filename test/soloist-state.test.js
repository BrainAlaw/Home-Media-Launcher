'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseMessage } = require('../backend/soloist/protocol');
const { initialSnapshot, reduce, toMediaState, trackFromEntity, interpolatedProgress } = require('../backend/soloist/state');

const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'soloist', 'wire-session.json'), 'utf8'));

function hydrate(value) {
  const entities = { TRACK_A: FIXTURES.trackA, TRACK_B: FIXTURES.trackB, TRACK_C: FIXTURES.trackC, CONTEXT: FIXTURES.context };
  if (typeof value === 'string' && Object.hasOwn(entities, value)) return entities[value];
  if (Array.isArray(value)) return value.map(hydrate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrate(item)]));
  return value;
}

/** Recorded frame by position in the session, parsed through the real protocol parser. */
const event = (index) => parseMessage(JSON.stringify(hydrate(FIXTURES.frames[index])));
const connected = (snapshot) => reduce(snapshot, { type: 'connection', connected: true });

const T0 = 1_760_000_000_000;

test('initial snapshot is disconnected, logged out and idle', () => {
  const snapshot = initialSnapshot();
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.loggedIn, false);
  assert.equal(snapshot.status, 'idle');
  assert.equal(snapshot.track, null);
  assert.deepEqual(snapshot.queue, { previous: [], upcoming: [] });
  assert.deepEqual(toMediaState(snapshot, T0), {
    auth: { status: 'error', message: 'Soloist offline' },
    playing: false,
    shuffle: false,
    repeat: 'off',
    device: { id: 'soloist', name: 'Soloist', type: 'Computer', active: false },
    idle: true,
    stale: true,
    updatedAt: T0
  });
});

test('reducer never mutates its input snapshot', () => {
  const before = initialSnapshot();
  const frozen = JSON.stringify(before);
  const after = reduce(before, event(0));
  assert.equal(JSON.stringify(before), frozen);
  assert.notEqual(after, before);
});

test('recorded session: login, play, position, pause, track change, volume, options, queue, errors', () => {
  let snapshot = connected(initialSnapshot());

  snapshot = reduce(snapshot, event(0), T0);
  assert.equal(snapshot.loggedIn, true);
  assert.equal(snapshot.isActive, true);
  assert.equal(snapshot.deviceName, 'Living Room PC');

  snapshot = reduce(snapshot, event(1), T0);
  assert.equal(snapshot.status, 'playing');
  assert.deepEqual(snapshot.track, {
    id: '4uLU6hMCjMI75M1A2tKUQC',
    uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    title: 'Song A',
    artists: ['Artist One', 'Artist Two'],
    album: 'Album X',
    artUrl: 'https://i.scdn.co/image/medium',
    durationMs: 215000
  });
  assert.deepEqual(snapshot.context, { uri: 'spotify:album:1xAlbumX', entityType: 'album' });
  assert.equal(snapshot.positionMs, 30000);
  assert.equal(snapshot.positionTimestampMs, 1_760_000_000_000);
  assert.equal(snapshot.volume, 40);
  assert.equal(snapshot.repeat, 'off');

  const playingMedia = toMediaState(snapshot, T0 + 2000);
  assert.equal(playingMedia.playing, true);
  assert.equal(playingMedia.progressMs, 32000, 'reported 30 s advanced by the 2 s clock delta');
  assert.equal(playingMedia.track.title, 'Song A');
  assert.equal(playingMedia.idle, false);
  assert.equal(playingMedia.volume, 40);
  assert.deepEqual(playingMedia.device, { id: 'soloist', name: 'Living Room PC', type: 'Computer', active: true, volume: 40 });
  assert.equal(playingMedia.auth.status, 'signed-in');
  assert.equal('stale' in playingMedia, false);

  snapshot = reduce(snapshot, event(2), T0);
  assert.equal(snapshot.positionMs, 31000);
  assert.equal(snapshot.positionTimestampMs, 1_760_000_001_000);

  snapshot = reduce(snapshot, event(3), T0);
  assert.equal(snapshot.status, 'paused');
  const pausedMedia = toMediaState(snapshot, T0 + 9000);
  assert.equal(pausedMedia.playing, false);
  assert.equal(pausedMedia.progressMs, 31000, 'paused position is not interpolated');
  assert.equal(pausedMedia.idle, false, 'paused with an active device is not idle');

  snapshot = reduce(snapshot, event(4), T0 + 9000);
  assert.equal(snapshot.track.title, 'Song B');
  assert.equal(snapshot.positionMs, 0);
  assert.equal(snapshot.positionTimestampMs, T0 + 9000);

  snapshot = reduce(snapshot, event(5), T0);
  assert.equal(snapshot.volume, 55);
  assert.equal(toMediaState(snapshot, T0).volume, 55);

  snapshot = reduce(snapshot, event(6), T0);
  assert.equal(snapshot.shuffle, true);
  assert.equal(snapshot.repeat, 'track');
  assert.equal(toMediaState(snapshot, T0).repeat, 'track');
  assert.equal(toMediaState(snapshot, T0).shuffle, true);

  snapshot = reduce(snapshot, event(7), T0);
  assert.deepEqual(snapshot.queue.previous.map((entry) => entry.uid), ['q-0']);
  assert.deepEqual(snapshot.queue.upcoming.map((entry) => entry.track.title), ['Song B', 'Song C']);
  assert.equal(snapshot.queue.upcoming[1].track.artUrl, undefined, 'empty cover list yields no artUrl');

  const beforeResult = JSON.stringify(snapshot);
  snapshot = reduce(snapshot, event(8), T0);
  assert.equal(JSON.stringify(snapshot), beforeResult, 'command_result leaves the snapshot unchanged');

  snapshot = reduce(snapshot, event(9), T0);
  assert.deepEqual(snapshot.lastError, { message: 'Command rejected', at: T0 });
});

test('playback_state with a logged-out auth state clears playback and repeat', () => {
  let snapshot = connected(initialSnapshot());
  snapshot = reduce(snapshot, event(0), T0);
  snapshot = reduce(snapshot, event(1), T0);
  snapshot = reduce(snapshot, event(6), T0);
  snapshot = reduce(snapshot, { type: 'auth_state', loggedIn: false, isActive: false, deviceName: null }, T0);
  assert.equal(snapshot.loggedIn, false);
  assert.equal(snapshot.status, 'idle');
  assert.equal(snapshot.track, null);
  assert.equal(snapshot.repeat, 'off');
  assert.equal(snapshot.shuffle, false);
  const media = toMediaState(snapshot, T0);
  assert.deepEqual(media.auth, { status: 'signed-out' });
  assert.equal(media.playing, false);
  assert.equal(media.idle, true);
});

test('device_changed and context_changed update the device and context', () => {
  let snapshot = connected(initialSnapshot());
  snapshot = reduce(snapshot, event(0), T0);
  snapshot = reduce(snapshot, { type: 'device_changed', isActive: false, deviceName: 'Phone' }, T0);
  assert.equal(snapshot.isActive, false);
  assert.equal(snapshot.deviceName, 'Phone');
  let media = toMediaState(snapshot, T0);
  assert.equal(media.device.active, false);
  assert.equal(media.device.name, 'Phone');
  assert.equal(media.idle, true, 'no active device and not playing is idle');

  snapshot = reduce(snapshot, { type: 'context_changed', context: null }, T0);
  assert.equal(snapshot.context, null);
  snapshot = reduce(snapshot, { type: 'playback_changed', status: 'buffering' }, T0);
  media = toMediaState(snapshot, T0);
  assert.equal(media.playing, true, 'buffering counts as playing');
});

test('progress interpolation advances with speed and clamps to the track length', () => {
  let snapshot = connected(initialSnapshot());
  snapshot = reduce(snapshot, event(0), T0);
  snapshot = reduce(snapshot, event(1), T0);
  snapshot = { ...snapshot, positionMs: 210000, positionTimestampMs: T0, speed: 1 };
  assert.equal(toMediaState(snapshot, T0 + 4000).progressMs, 214000);
  assert.equal(toMediaState(snapshot, T0 + 60000).progressMs, 215000, 'clamped to durationMs');
  assert.equal(toMediaState(snapshot, T0 - 5000).progressMs, 210000, 'a clock behind the timestamp does not rewind');

  const fast = { ...snapshot, positionMs: 1000, speed: 2 };
  assert.equal(interpolatedProgress(fast, true, T0 + 500), 2000);
  assert.equal(interpolatedProgress(fast, false, T0 + 500), 1000);
  const noTimestamp = { ...snapshot, positionMs: 5000, positionTimestampMs: 0 };
  assert.equal(interpolatedProgress(noTimestamp, true, T0), 5000, 'unknown timestamp means no interpolation');
});

test('buffering and paused snapshots without an active device report idle', () => {
  let snapshot = connected(initialSnapshot());
  snapshot = reduce(snapshot, { type: 'auth_state', loggedIn: true, isActive: false, deviceName: null }, T0);
  snapshot = reduce(snapshot, { type: 'playback_changed', status: 'paused' }, T0);
  const media = toMediaState(snapshot, T0);
  assert.equal(media.playing, false);
  assert.equal(media.idle, true);
  assert.equal(media.device.name, 'Soloist');
  assert.equal(media.device.active, false);
});

test('disconnected snapshots never report playing, even with stale playback', () => {
  let snapshot = reduce(initialSnapshot(), event(0), T0);
  snapshot = connected(snapshot);
  snapshot = reduce(snapshot, event(1), T0);
  assert.equal(toMediaState(snapshot, T0).playing, true);
  snapshot = reduce(snapshot, { type: 'connection', connected: false }, T0);
  const media = toMediaState(snapshot, T0 + 1000);
  assert.equal(media.playing, false);
  assert.equal(media.idle, true);
  assert.equal(media.stale, true);
  assert.deepEqual(media.auth, { status: 'error', message: 'Soloist offline' });
  assert.equal(media.progressMs, 30000, 'last known position is kept, not interpolated');
});

test('trackFromEntity tolerates missing decorations and selects art by width', () => {
  assert.equal(trackFromEntity(null), null);
  assert.equal(trackFromEntity({ uri: '' }), null);
  assert.deepEqual(trackFromEntity({ uri: 'spotify:episode:e1', decorations: {} }), {
    id: 'e1',
    uri: 'spotify:episode:e1',
    title: '',
    artists: [],
    album: '',
    durationMs: 0
  });
  const artOnly = trackFromEntity({
    uri: 'spotify:track:t',
    decorations: { visual_identity: { cover: [{ url: 'https://i/a', width: 64 }, { url: 'https://i/b', width: 640 }, { width: 900 }] }, creators: [{ name: 'Plain' }, {}] }
  });
  assert.equal(artOnly.artUrl, 'https://i/b', 'smallest image of at least 300 px, ignoring entries without a URL');
  assert.deepEqual(artOnly.artists, ['Plain']);
  const smallOnly = trackFromEntity({ uri: 'spotify:track:t', decorations: { visual_identity: { cover: [{ url: 'https://i/s', width: 64 }, { url: 'https://i/m', width: 128 }] } } });
  assert.equal(smallOnly.artUrl, 'https://i/m', 'falls back to the largest image when none reaches 300 px');
});

test('queue entries without a resolvable track are dropped', () => {
  const snapshot = reduce(initialSnapshot(), { type: 'queue_changed', previous: [], upcoming: [{ uid: 'a', source: null, item: null }, { uid: 'b', source: null, item: hydrate(FIXTURES.trackB) }] }, T0);
  assert.deepEqual(snapshot.queue.upcoming.map((entry) => entry.uid), ['b']);
});

test('position_sync without a timestamp falls back to the receive time', () => {
  const snapshot = reduce(initialSnapshot(), { type: 'position_sync', position: { positionMs: 500, timestampMs: 0, speed: 1 } }, T0);
  assert.equal(snapshot.positionMs, 500);
  assert.equal(snapshot.positionTimestampMs, T0);
});
