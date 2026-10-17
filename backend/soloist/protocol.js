'use strict';

/**
 * Pure builders and parsers for the Soloist WebSocket protocol (`soloist --ws 127.0.0.1:PORT`).
 * JSON text frames only. No I/O, no clock, no dependencies: safe to import from the main process and from tests.
 */

class ProtocolError extends Error {
  /** @param {string} message Human-readable reason. Never includes message bodies or tokens. */
  constructor(message) {
    super(message);
    this.name = 'ProtocolError';
    this.code = 'INVALID';
  }
}

const PLAYBACK_STATUSES = Object.freeze(['idle', 'playing', 'paused', 'buffering']);
const REPEAT_MODES = Object.freeze(['off', 'context', 'track']);
const SPOTIFY_URI_PATTERN = /^spotify:(track|album|playlist|episode|show|artist):[A-Za-z0-9]+$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isBoolean = (value) => typeof value === 'boolean';
const isNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

const validators = Object.freeze({
  uri: (value, field) => {
    if (typeof value !== 'string' || !SPOTIFY_URI_PATTERN.test(value)) throw new ProtocolError(`${field} must be a Spotify URI`);
  },
  boolean: (value, field) => {
    if (!isBoolean(value)) throw new ProtocolError(`${field} must be a boolean`);
  },
  nonNegativeInteger: (value, field) => {
    if (!isNonNegativeInteger(value)) throw new ProtocolError(`${field} must be a non-negative integer`);
  },
  positiveInteger: (value, field) => {
    if (!isNonNegativeInteger(value) || value === 0) throw new ProtocolError(`${field} must be a positive integer`);
  },
  volume: (value, field) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new ProtocolError(`${field} must be an integer from 0 to 100`);
  }
});

/**
 * Command schema. `required` fields must be present, `optional` may be omitted. Any other field is rejected.
 * Query commands (get_auth_state, get_state, get_queue) are answered by an event, not by command_result.
 */
const COMMAND_SCHEMA = Object.freeze({
  get_auth_state: { required: {}, optional: {} },
  get_state: { required: {}, optional: {} },
  get_queue: { required: {}, optional: { limit: validators.positiveInteger } },
  play: { required: {}, optional: { uri: validators.uri } },
  pause: { required: {}, optional: {} },
  skip_next: { required: {}, optional: {} },
  skip_prev: { required: {}, optional: {} },
  seek: { required: { position_ms: validators.nonNegativeInteger }, optional: {} },
  set_volume: { required: { volume: validators.volume }, optional: {} },
  set_shuffle: { required: { enabled: validators.boolean }, optional: {} },
  set_repeat_context: { required: { enabled: validators.boolean }, optional: {} },
  set_repeat_track: { required: { enabled: validators.boolean }, optional: {} },
  add_to_queue: { required: { uri: validators.uri }, optional: {} },
  activate: { required: {}, optional: {} },
  deactivate: { required: {}, optional: {} }
});

/** Query command -> event type that answers it. */
const QUERY_REPLY = Object.freeze({
  get_auth_state: 'auth_state',
  get_state: 'playback_state',
  get_queue: 'queue_changed'
});

/**
 * Build a validated client message.
 * @param {string} name One of the COMMAND_SCHEMA keys.
 * @param {Record<string, unknown>} [fields] Wire field names (snake_case), e.g. `{ position_ms: 1000 }`.
 * @returns {{ type: 'command', command: string } & Record<string, unknown>}
 * @throws {ProtocolError} unknown command, unexpected or missing field, or invalid value.
 */
function buildCommand(name, fields = {}) {
  if (!Object.hasOwn(COMMAND_SCHEMA, name)) throw new ProtocolError(`Unknown command: ${String(name)}`);
  if (!isObject(fields)) throw new ProtocolError('Command fields must be an object');
  const schema = COMMAND_SCHEMA[name];
  for (const key of Object.keys(fields)) {
    if (!Object.hasOwn(schema.required, key) && !Object.hasOwn(schema.optional, key)) {
      throw new ProtocolError(`Unexpected field ${key} for ${name}`);
    }
  }
  const message = { type: 'command', command: name };
  for (const [key, check] of Object.entries(schema.required)) {
    if (fields[key] === undefined) throw new ProtocolError(`Missing field ${key} for ${name}`);
    check(fields[key], key);
    message[key] = fields[key];
  }
  for (const [key, check] of Object.entries(schema.optional)) {
    if (fields[key] === undefined) continue;
    check(fields[key], key);
    message[key] = fields[key];
  }
  return message;
}

/**
 * Two-command sequence for a repeat mode (Soloist has no single repeat command).
 * off: track false + context false; context: track false + context true; track: context false + track true.
 * @param {'off'|'context'|'track'} mode
 * @returns {Array<{ command: string, fields: Record<string, boolean> }>}
 */
function repeatCommandSequence(mode) {
  switch (mode) {
    case 'off':
      return [{ command: 'set_repeat_track', fields: { enabled: false } }, { command: 'set_repeat_context', fields: { enabled: false } }];
    case 'context':
      return [{ command: 'set_repeat_track', fields: { enabled: false } }, { command: 'set_repeat_context', fields: { enabled: true } }];
    case 'track':
      return [{ command: 'set_repeat_context', fields: { enabled: false } }, { command: 'set_repeat_track', fields: { enabled: true } }];
    default:
      throw new ProtocolError(`Unknown repeat mode: ${String(mode)}`);
  }
}

/* ------------------------------------------------------------------ parsing */

const requireObject = (value, what) => {
  if (!isObject(value)) throw new ProtocolError(`${what} must be an object`);
  return value;
};

const optionalString = (value) => (typeof value === 'string' ? value : null);

/** Entity `{ uri, entity_type, decorations }` -> `{ uri, entityType, decorations }`. Decorations keep the wire shape. */
function parseEntity(raw) {
  if (raw === null || raw === undefined) return null;
  const entity = requireObject(raw, 'entity');
  if (typeof entity.uri !== 'string' || entity.uri === '') throw new ProtocolError('entity.uri must be a non-empty string');
  return {
    uri: entity.uri,
    entityType: typeof entity.entity_type === 'string' ? entity.entity_type : '',
    decorations: isObject(entity.decorations) ? entity.decorations : {}
  };
}

/** `{ position_ms, timestamp_ms, speed }` -> `{ positionMs, timestampMs, speed }`. */
function parsePosition(raw) {
  const position = requireObject(raw, 'position');
  const positionMs = position.position_ms;
  const timestampMs = position.timestamp_ms;
  if (!Number.isFinite(positionMs) || positionMs < 0) throw new ProtocolError('position.position_ms must be a non-negative number');
  if (!Number.isFinite(timestampMs)) throw new ProtocolError('position.timestamp_ms must be a number');
  return {
    positionMs: Math.round(positionMs),
    timestampMs: Math.round(timestampMs),
    speed: Number.isFinite(position.speed) ? position.speed : 1
  };
}

/** `{ shuffle, repeat, playback_speed, modes }` -> `{ shuffle, repeat, playbackSpeed, modes }`. */
function parseOptions(raw) {
  const options = requireObject(raw, 'options');
  if (!isBoolean(options.shuffle)) throw new ProtocolError('options.shuffle must be a boolean');
  if (!REPEAT_MODES.includes(options.repeat)) throw new ProtocolError('options.repeat must be off, context or track');
  return {
    shuffle: options.shuffle,
    repeat: options.repeat,
    playbackSpeed: Number.isFinite(options.playback_speed) ? options.playback_speed : 1,
    modes: isObject(options.modes) ? options.modes : {}
  };
}

function parseStatus(value) {
  if (!PLAYBACK_STATUSES.includes(value)) throw new ProtocolError('status must be idle, playing, paused or buffering');
  return value;
}

function parseVolume(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) throw new ProtocolError('volume must be a number or null');
  return Math.min(100, Math.max(0, Math.round(value)));
}

function parseQueueEntries(raw, field) {
  if (!Array.isArray(raw)) throw new ProtocolError(`${field} must be an array`);
  return raw.map((entry) => {
    const item = requireObject(entry, `${field} entry`);
    return {
      uid: typeof item.uid === 'string' ? item.uid : '',
      source: item.source ?? null,
      item: parseEntity(item.item)
    };
  });
}

const PARSERS = Object.freeze({
  auth_state: (msg) => ({
    type: 'auth_state',
    loggedIn: Boolean(msg.logged_in),
    isActive: Boolean(msg.is_active),
    deviceName: optionalString(msg.device_name)
  }),
  playback_state: (msg) => ({
    type: 'playback_state',
    status: parseStatus(msg.status),
    item: parseEntity(msg.item),
    context: parseEntity(msg.context),
    position: parsePosition(msg.position),
    volume: parseVolume(msg.volume),
    isActive: Boolean(msg.is_active),
    options: parseOptions(msg.options),
    availableActions: Array.isArray(msg.available_actions) ? msg.available_actions.filter((action) => typeof action === 'string') : []
  }),
  track_changed: (msg) => ({ type: 'track_changed', item: parseEntity(msg.item) }),
  playback_changed: (msg) => ({ type: 'playback_changed', status: parseStatus(msg.status) }),
  volume_changed: (msg) => ({ type: 'volume_changed', volume: parseVolume(msg.volume) }),
  device_changed: (msg) => ({ type: 'device_changed', isActive: Boolean(msg.is_active), deviceName: optionalString(msg.device_name) }),
  context_changed: (msg) => ({ type: 'context_changed', context: parseEntity(msg.context) }),
  options_changed: (msg) => ({ type: 'options_changed', options: parseOptions(msg.options) }),
  position_sync: (msg) => ({ type: 'position_sync', position: parsePosition(msg.position) }),
  queue_changed: (msg) => ({
    type: 'queue_changed',
    previous: parseQueueEntries(msg.previous ?? [], 'previous'),
    upcoming: parseQueueEntries(msg.upcoming ?? [], 'upcoming')
  }),
  command_result: (msg) => {
    if (typeof msg.command !== 'string' || msg.command === '') throw new ProtocolError('command_result.command must be a string');
    return { type: 'command_result', command: msg.command };
  }
});

/** Malformed frame as an error event; `malformed: true` distinguishes it from a server `error` event. */
function malformed(reason) {
  return { type: 'error', malformed: true, message: `Malformed Soloist message: ${reason}` };
}

/**
 * Parse one text frame into a typed event. Never throws.
 * - Known events -> camelCase objects (see PARSERS).
 * - Server `error` -> `{ type: 'error', malformed: false, message }`.
 * - Invalid JSON or invalid payload -> `{ type: 'error', malformed: true, message }`.
 * - Unknown event type -> `{ type: 'unknown', eventType }`.
 * @param {string} text
 */
function parseMessage(text) {
  if (typeof text !== 'string') return malformed('frame is not text');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return malformed('invalid JSON');
  }
  if (!isObject(raw) || typeof raw.type !== 'string') return malformed('missing event type');
  if (raw.type === 'error') {
    return { type: 'error', malformed: false, message: typeof raw.message === 'string' ? raw.message : '' };
  }
  if (!Object.hasOwn(PARSERS, raw.type)) return { type: 'unknown', eventType: raw.type };
  try {
    return PARSERS[raw.type](raw);
  } catch (error) {
    if (error instanceof ProtocolError) return malformed(`${raw.type}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  ProtocolError,
  PLAYBACK_STATUSES,
  REPEAT_MODES,
  SPOTIFY_URI_PATTERN,
  COMMAND_SCHEMA,
  QUERY_REPLY,
  buildCommand,
  repeatCommandSequence,
  parseMessage
};
