'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ProtocolError, buildCommand, repeatCommandSequence, parseMessage, QUERY_REPLY } = require('../backend/soloist/protocol');

const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'soloist', 'wire-session.json'), 'utf8'));

/** Replace the TRACK_A/TRACK_B/TRACK_C/CONTEXT placeholders in a recorded frame with their entity objects. */
function hydrate(value) {
  const entities = { TRACK_A: FIXTURES.trackA, TRACK_B: FIXTURES.trackB, TRACK_C: FIXTURES.trackC, CONTEXT: FIXTURES.context };
  if (typeof value === 'string' && Object.hasOwn(entities, value)) return entities[value];
  if (Array.isArray(value)) return value.map(hydrate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrate(item)]));
  return value;
}

test('buildCommand emits the command envelope for every control command', () => {
  assert.deepEqual(buildCommand('play'), { type: 'command', command: 'play' });
  assert.deepEqual(buildCommand('play', { uri: 'spotify:album:1xAlbumX' }), { type: 'command', command: 'play', uri: 'spotify:album:1xAlbumX' });
  assert.deepEqual(buildCommand('pause'), { type: 'command', command: 'pause' });
  assert.deepEqual(buildCommand('skip_next'), { type: 'command', command: 'skip_next' });
  assert.deepEqual(buildCommand('skip_prev'), { type: 'command', command: 'skip_prev' });
  assert.deepEqual(buildCommand('seek', { position_ms: 0 }), { type: 'command', command: 'seek', position_ms: 0 });
  assert.deepEqual(buildCommand('set_volume', { volume: 0 }), { type: 'command', command: 'set_volume', volume: 0 });
  assert.deepEqual(buildCommand('set_volume', { volume: 100 }), { type: 'command', command: 'set_volume', volume: 100 });
  assert.deepEqual(buildCommand('set_shuffle', { enabled: true }), { type: 'command', command: 'set_shuffle', enabled: true });
  assert.deepEqual(buildCommand('set_repeat_context', { enabled: false }), { type: 'command', command: 'set_repeat_context', enabled: false });
  assert.deepEqual(buildCommand('set_repeat_track', { enabled: true }), { type: 'command', command: 'set_repeat_track', enabled: true });
  assert.deepEqual(buildCommand('add_to_queue', { uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' }), { type: 'command', command: 'add_to_queue', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' });
  assert.deepEqual(buildCommand('activate'), { type: 'command', command: 'activate' });
  assert.deepEqual(buildCommand('deactivate'), { type: 'command', command: 'deactivate' });
});

test('buildCommand emits the query commands', () => {
  assert.deepEqual(buildCommand('get_auth_state'), { type: 'command', command: 'get_auth_state' });
  assert.deepEqual(buildCommand('get_state'), { type: 'command', command: 'get_state' });
  assert.deepEqual(buildCommand('get_queue'), { type: 'command', command: 'get_queue' });
  assert.deepEqual(buildCommand('get_queue', { limit: 5 }), { type: 'command', command: 'get_queue', limit: 5 });
  assert.deepEqual(QUERY_REPLY, { get_auth_state: 'auth_state', get_state: 'playback_state', get_queue: 'queue_changed' });
});

test('buildCommand rejects unknown commands and unexpected fields', () => {
  assert.throws(() => buildCommand('explode'), ProtocolError);
  assert.throws(() => buildCommand('pause', { force: true }), /Unexpected field force/);
  assert.throws(() => buildCommand('set_volume', { volume: 40, enabled: true }), /Unexpected field enabled/);
  assert.throws(() => buildCommand('pause', 'x'), /must be an object/);
  assert.throws(() => buildCommand('__proto__'), ProtocolError);
  assert.throws(() => buildCommand('toString'), ProtocolError);
});

test('buildCommand enforces required fields', () => {
  assert.throws(() => buildCommand('seek'), /Missing field position_ms/);
  assert.throws(() => buildCommand('set_volume'), /Missing field volume/);
  assert.throws(() => buildCommand('set_shuffle', {}), /Missing field enabled/);
  assert.throws(() => buildCommand('add_to_queue'), /Missing field uri/);
});

test('buildCommand validates volume as an integer from 0 to 100', () => {
  for (const volume of [-1, 101, 40.5, Number.NaN, Number.POSITIVE_INFINITY, '40', null, true]) {
    assert.throws(() => buildCommand('set_volume', { volume }), /volume must be an integer from 0 to 100/, `volume ${String(volume)}`);
  }
});

test('buildCommand validates position_ms as a non-negative integer', () => {
  for (const position_ms of [-1, 1.5, Number.NaN, '1000', null]) {
    assert.throws(() => buildCommand('seek', { position_ms }), /position_ms must be a non-negative integer/, `position ${String(position_ms)}`);
  }
  assert.deepEqual(buildCommand('seek', { position_ms: 2_147_483_647 }).position_ms, 2_147_483_647);
});

test('buildCommand validates limit as a positive integer', () => {
  assert.throws(() => buildCommand('get_queue', { limit: 0 }), /limit must be a positive integer/);
  assert.throws(() => buildCommand('get_queue', { limit: -3 }), /limit must be a positive integer/);
  assert.throws(() => buildCommand('get_queue', { limit: 2.5 }), /limit must be a positive integer/);
});

test('buildCommand requires booleans for toggles', () => {
  for (const enabled of [1, 0, 'true', null]) {
    assert.throws(() => buildCommand('set_shuffle', { enabled }), /enabled must be a boolean/, `enabled ${String(enabled)}`);
    assert.throws(() => buildCommand('set_repeat_track', { enabled }), /enabled must be a boolean/);
    assert.throws(() => buildCommand('set_repeat_context', { enabled }), /enabled must be a boolean/);
  }
});

test('Spotify URIs must be track, album, playlist, episode, show or artist with an ID', () => {
  const valid = ['spotify:track:4uLU6hMCjMI75M1A2tKUQC', 'spotify:album:1x', 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', 'spotify:episode:abc', 'spotify:show:abc', 'spotify:artist:abc'];
  for (const uri of valid) assert.equal(buildCommand('play', { uri }).uri, uri);
  const invalid = ['', 'spotify:user:abc', 'spotify:track:', 'spotify:track:abc def', 'https://open.spotify.com/track/abc', 'spotify:track:abc/extra', 'SPOTIFY:track:abc', 42];
  for (const uri of invalid) {
    assert.throws(() => buildCommand('play', { uri }), /must be a Spotify URI/, String(uri));
    assert.throws(() => buildCommand('add_to_queue', { uri }), /must be a Spotify URI/, String(uri));
  }
});

test('repeatCommandSequence maps each mode to the documented two-command order', () => {
  assert.deepEqual(repeatCommandSequence('off'), [
    { command: 'set_repeat_track', fields: { enabled: false } },
    { command: 'set_repeat_context', fields: { enabled: false } }
  ]);
  assert.deepEqual(repeatCommandSequence('context'), [
    { command: 'set_repeat_track', fields: { enabled: false } },
    { command: 'set_repeat_context', fields: { enabled: true } }
  ]);
  assert.deepEqual(repeatCommandSequence('track'), [
    { command: 'set_repeat_context', fields: { enabled: false } },
    { command: 'set_repeat_track', fields: { enabled: true } }
  ]);
  for (const mode of ['overall', '', undefined]) assert.throws(() => repeatCommandSequence(mode), ProtocolError);
});

test('every repeat step is a valid command', () => {
  for (const mode of ['off', 'context', 'track']) {
    for (const step of repeatCommandSequence(mode)) assert.equal(buildCommand(step.command, step.fields).command, step.command);
  }
});

test('parseMessage maps the recorded auth and playback frames to camelCase events', () => {
  const [auth, playing] = FIXTURES.frames;
  assert.deepEqual(parseMessage(JSON.stringify(auth)), { type: 'auth_state', loggedIn: true, isActive: true, deviceName: 'Living Room PC' });

  const event = parseMessage(JSON.stringify({ ...playing, item: FIXTURES.trackA, context: FIXTURES.context }));
  assert.equal(event.type, 'playback_state');
  assert.equal(event.status, 'playing');
  assert.equal(event.item.uri, 'spotify:track:4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(event.item.entityType, 'track');
  assert.equal(event.item.decorations.identity.name, 'Song A');
  assert.equal(event.context.entityType, 'album');
  assert.deepEqual(event.position, { positionMs: 30000, timestampMs: 1760000000000, speed: 1 });
  assert.equal(event.volume, 40);
  assert.equal(event.isActive, true);
  assert.deepEqual(event.options, { shuffle: false, repeat: 'off', playbackSpeed: 1, modes: {} });
  assert.ok(event.availableActions.includes('pause'));
});

test('parseMessage maps the remaining event types', () => {
  const frames = FIXTURES.frames;
  const by = (type) => parseMessage(JSON.stringify(frames.find((frame) => frame.type === type)));
  assert.deepEqual(by('position_sync'), { type: 'position_sync', position: { positionMs: 31000, timestampMs: 1760000001000, speed: 1 } });
  assert.deepEqual(by('playback_changed'), { type: 'playback_changed', status: 'paused' });
  assert.deepEqual(by('volume_changed'), { type: 'volume_changed', volume: 55 });
  assert.deepEqual(by('options_changed').options, { shuffle: true, repeat: 'track', playbackSpeed: 1, modes: {} });
  assert.deepEqual(by('command_result'), { type: 'command_result', command: 'pause' });
  assert.deepEqual(by('error'), { type: 'error', malformed: false, message: 'Command rejected' });
  assert.deepEqual(parseMessage(JSON.stringify({ type: 'device_changed', is_active: false, device_name: 'Other' })), { type: 'device_changed', isActive: false, deviceName: 'Other' });
  assert.deepEqual(parseMessage(JSON.stringify({ type: 'context_changed', context: null })), { type: 'context_changed', context: null });
  assert.deepEqual(parseMessage(JSON.stringify({ type: 'track_changed', item: null })), { type: 'track_changed', item: null });
});

test('parseMessage keeps queue entries with uid, source and item', () => {
  const queue = parseMessage(JSON.stringify(hydrate(FIXTURES.frames.find((frame) => frame.type === 'queue_changed'))));
  assert.equal(queue.type, 'queue_changed');
  assert.deepEqual(queue.previous.map((entry) => entry.uid), ['q-0']);
  assert.deepEqual(queue.upcoming.map((entry) => entry.uid), ['q-1', 'q-2']);
  assert.equal(queue.upcoming[1].item.uri, 'spotify:track:9cTrackC');
  const empty = parseMessage(JSON.stringify({ type: 'queue_changed', previous: [], upcoming: [{ uid: 'x', source: null, item: null }] }));
  assert.equal(empty.upcoming[0].item, null, 'entries without a resolved entity keep a null item');
  const populated = parseMessage(JSON.stringify({ type: 'queue_changed', previous: [], upcoming: [{ uid: 'u', source: 'x', item: FIXTURES.trackB }] }));
  assert.equal(populated.upcoming[0].item.uri, 'spotify:track:7bTrackB');
});

test('parseMessage returns malformed errors for invalid JSON and invalid frames without throwing', () => {
  const malformed = [
    '{not json',
    '',
    'null',
    '[]',
    '"text"',
    '{}',
    '{"type":42}',
    JSON.stringify({ type: 'playback_state', status: 'rewinding' }),
    JSON.stringify({ type: 'volume_changed', volume: 'loud' }),
    '{"type":"volume_changed","volume":1e400}',
    JSON.stringify({ type: 'position_sync', position: { position_ms: -5, timestamp_ms: 1 } }),
    JSON.stringify({ type: 'options_changed', options: { shuffle: 'yes', repeat: 'off' } }),
    JSON.stringify({ type: 'track_changed', item: { uri: '' } }),
    JSON.stringify({ type: 'command_result' })
  ];
  for (const text of malformed) {
    const event = parseMessage(text);
    assert.equal(event.type, 'error', text);
    assert.equal(event.malformed, true, text);
    assert.match(event.message, /^Malformed Soloist message: /);
  }
  assert.equal(parseMessage(undefined).malformed, true);
  assert.equal(parseMessage(Buffer.from('{}')).malformed, true);
});

test('parseMessage reports unknown event types without failing', () => {
  assert.deepEqual(parseMessage(JSON.stringify({ type: 'future_event', foo: 1 })), { type: 'unknown', eventType: 'future_event' });
});

test('server error events are not malformed and carry only the message string', () => {
  const event = parseMessage(JSON.stringify({ type: 'error', message: 'No active device', extra: 'ignored' }));
  assert.deepEqual(event, { type: 'error', malformed: false, message: 'No active device' });
  assert.deepEqual(parseMessage(JSON.stringify({ type: 'error' })), { type: 'error', malformed: false, message: '' });
});
