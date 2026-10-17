'use strict';

/**
 * Pure reducer from parsed Soloist events (see protocol.js) to a snapshot, and the mapping of a snapshot to the
 * ns `media` MediaState (backend/contracts.d.ts). Mirrors backend/spotify/mappers.js: `idle` means nothing is playing
 * and no device is active; the device id is fixed to 'soloist'.
 */

const ART_TARGET_WIDTH = 300;
const DEVICE_ID = 'soloist';
const DEVICE_NAME_FALLBACK = 'Soloist';

/** @typedef {{ id: string, uri: string, title: string, artists: string[], album: string, artUrl?: string, durationMs: number }} MediaTrack */
/** @typedef {{ uid: string, source: unknown, track: MediaTrack }} QueueEntry */
/**
 * @typedef {object} SoloistSnapshot
 * @property {boolean} connected
 * @property {boolean} loggedIn
 * @property {boolean} isActive
 * @property {string|null} deviceName
 * @property {'idle'|'playing'|'paused'|'buffering'} status
 * @property {MediaTrack|null} track
 * @property {{ uri: string, entityType: string }|null} context
 * @property {number} positionMs
 * @property {number} positionTimestampMs
 * @property {number} speed
 * @property {number|null} volume
 * @property {boolean} shuffle
 * @property {'off'|'context'|'track'} repeat
 * @property {{ previous: QueueEntry[], upcoming: QueueEntry[] }} queue
 * @property {{ message: string, at: number }|null} lastError
 */

/** @returns {SoloistSnapshot} */
function initialSnapshot() {
  return {
    connected: false,
    loggedIn: false,
    isActive: false,
    deviceName: null,
    status: 'idle',
    track: null,
    context: null,
    positionMs: 0,
    positionTimestampMs: 0,
    speed: 1,
    volume: null,
    shuffle: false,
    repeat: 'off',
    queue: { previous: [], upcoming: [] },
    lastError: null
  };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value) => (typeof value === 'string' && value !== '' ? value : '');

/** Smallest image at least 300 px wide, otherwise the largest one (same rule as mappers.pickImage). */
function pickCover(cover) {
  if (!Array.isArray(cover)) return undefined;
  const usable = cover.filter((image) => isObject(image) && typeof image.url === 'string' && image.url !== '');
  if (!usable.length) return undefined;
  const sorted = [...usable].sort((a, b) => (Number(a.width) || 0) - (Number(b.width) || 0));
  return (sorted.find((image) => (Number(image.width) || 0) >= ART_TARGET_WIDTH) || sorted[sorted.length - 1]).url;
}

/** Creator entities carry `decorations.identity.name`; plain `{ name }` objects are accepted too. */
function creatorNames(creators) {
  if (!Array.isArray(creators)) return [];
  return creators
    .map((creator) => nonEmptyString(creator?.decorations?.identity?.name) || nonEmptyString(creator?.name))
    .filter(Boolean);
}

/**
 * Track entity -> MediaTrack. Title from identity.name, artists from creators[], album from parent.entity
 * (the show name for episodes), art from visual_identity.cover[], duration from playback.duration_ms.
 * @param {{ uri: string, decorations?: Record<string, any> }|null} entity
 * @returns {MediaTrack|null}
 */
function trackFromEntity(entity) {
  if (!entity || typeof entity.uri !== 'string' || entity.uri === '') return null;
  const decorations = isObject(entity.decorations) ? entity.decorations : {};
  const artUrl = pickCover(decorations.visual_identity?.cover);
  const durationMs = Number(decorations.playback?.duration_ms);
  return {
    id: entity.uri.split(':').pop() || entity.uri,
    uri: entity.uri,
    title: nonEmptyString(decorations.identity?.name),
    artists: creatorNames(decorations.creators),
    album: nonEmptyString(decorations.parent?.entity?.decorations?.identity?.name),
    ...(artUrl ? { artUrl } : {}),
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0
  };
}

const contextFromEntity = (entity) => (entity ? { uri: entity.uri, entityType: entity.entityType } : null);

function queueEntries(entries) {
  return entries
    .map((entry) => {
      const track = trackFromEntity(entry.item);
      return track ? { uid: entry.uid, source: entry.source, track } : null;
    })
    .filter(Boolean);
}

/** Reset everything that only exists while logged in and playing. */
function clearedPlayback(snapshot) {
  return {
    ...snapshot,
    status: 'idle',
    track: null,
    context: null,
    positionMs: 0,
    positionTimestampMs: 0,
    speed: 1,
    volume: null,
    queue: { previous: [], upcoming: [] }
  };
}

/**
 * Apply one event. Returns a new snapshot; the input is never mutated.
 * @param {SoloistSnapshot} snapshot
 * @param {{ type: string } & Record<string, any>} event Parsed event from protocol.parseMessage, or an internal
 *   `{ type: 'connection', connected }` event emitted by the client.
 * @param {number} [at=0] Receive time in ms (Date.now() semantics), used as the position timestamp when the event carries none.
 * @returns {SoloistSnapshot}
 */
function reduce(snapshot, event, at = 0) {
  switch (event.type) {
    case 'connection':
      return { ...snapshot, connected: Boolean(event.connected) };
    case 'auth_state': {
      const next = { ...snapshot, loggedIn: event.loggedIn, isActive: event.isActive, deviceName: event.deviceName };
      return event.loggedIn ? next : { ...clearedPlayback(next), shuffle: false, repeat: 'off' };
    }
    case 'playback_state':
      return {
        ...snapshot,
        status: event.status,
        track: trackFromEntity(event.item),
        context: contextFromEntity(event.context),
        positionMs: event.position.positionMs,
        positionTimestampMs: event.position.timestampMs,
        speed: event.position.speed,
        volume: event.volume,
        isActive: event.isActive,
        shuffle: event.options.shuffle,
        repeat: event.options.repeat
      };
    case 'track_changed':
      return { ...snapshot, track: trackFromEntity(event.item), positionMs: 0, positionTimestampMs: at };
    case 'playback_changed':
      return { ...snapshot, status: event.status };
    case 'volume_changed':
      return { ...snapshot, volume: event.volume };
    case 'device_changed':
      return { ...snapshot, isActive: event.isActive, deviceName: event.deviceName };
    case 'context_changed':
      return { ...snapshot, context: contextFromEntity(event.context) };
    case 'options_changed':
      return { ...snapshot, shuffle: event.options.shuffle, repeat: event.options.repeat };
    case 'position_sync':
      return {
        ...snapshot,
        positionMs: event.position.positionMs,
        positionTimestampMs: event.position.timestampMs || at,
        speed: event.position.speed
      };
    case 'queue_changed':
      return { ...snapshot, queue: { previous: queueEntries(event.previous), upcoming: queueEntries(event.upcoming) } };
    case 'error':
      return { ...snapshot, lastError: { message: event.message, at } };
    default:
      return snapshot;
  }
}

/** Position at `nowMs`: the last reported position advanced by elapsed time * speed while playing, clamped to the track length. */
function interpolatedProgress(snapshot, playing, nowMs) {
  let progress = snapshot.positionMs;
  if (playing && snapshot.positionTimestampMs > 0 && nowMs > snapshot.positionTimestampMs) {
    progress += (nowMs - snapshot.positionTimestampMs) * snapshot.speed;
  }
  if (snapshot.track && snapshot.track.durationMs > 0) progress = Math.min(progress, snapshot.track.durationMs);
  return Math.max(0, Math.round(progress));
}

/**
 * Map a snapshot to MediaState. Disconnected snapshots report `playing: false`, `idle: true` and `stale: true`.
 * @param {SoloistSnapshot} snapshot
 * @param {number} nowMs
 * @returns {import('../contracts').MediaState}
 */
function toMediaState(snapshot, nowMs) {
  const connected = snapshot.connected;
  const playing = connected && snapshot.loggedIn && (snapshot.status === 'playing' || snapshot.status === 'buffering');
  const deviceActive = connected && snapshot.isActive;
  const device = {
    id: DEVICE_ID,
    name: nonEmptyString(snapshot.deviceName) || DEVICE_NAME_FALLBACK,
    type: 'Computer',
    active: deviceActive,
    ...(snapshot.volume !== null ? { volume: snapshot.volume } : {})
  };
  let auth;
  if (!connected) auth = { status: 'error', message: 'Soloist offline' };
  else if (snapshot.loggedIn) auth = { status: 'signed-in', displayName: DEVICE_NAME_FALLBACK };
  else auth = { status: 'signed-out' };
  const track = snapshot.loggedIn ? snapshot.track : null;
  return {
    auth,
    playing,
    ...(track ? { track, progressMs: interpolatedProgress(snapshot, playing, nowMs) } : {}),
    shuffle: snapshot.shuffle,
    repeat: snapshot.repeat,
    ...(snapshot.volume !== null ? { volume: snapshot.volume } : {}),
    device,
    idle: !playing && !deviceActive,
    ...(connected ? {} : { stale: true }),
    updatedAt: nowMs
  };
}

module.exports = { initialSnapshot, reduce, toMediaState, trackFromEntity, interpolatedProgress, DEVICE_ID };
