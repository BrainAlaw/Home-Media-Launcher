'use strict';

const DEFAULT_MAX = 3;
const MIN_MAX = 1;
const MAX_MAX = 8;

/**
 * Validates `settings.backgroundApps` (optional block). Throws a message that names the offending key.
 * @param {unknown} value
 */
function validateBackgroundApps(value) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('backgroundApps must be an object');
  if (value.max !== undefined && (!Number.isInteger(value.max) || value.max < MIN_MAX || value.max > MAX_MAX)) {
    throw new Error(`backgroundApps.max must be an integer from ${MIN_MAX} to ${MAX_MAX}`);
  }
}

/** Reads the configured limit, falling back to the default when the block or the value is missing. */
function backgroundLimit(settings) {
  const value = settings?.backgroundApps?.max;
  return Number.isInteger(value) && value >= MIN_MAX && value <= MAX_MAX ? value : DEFAULT_MAX;
}

/**
 * Apps that are alive but not on screen, oldest first. The registry holds ids only; the caller owns the windows and
 * closes whatever `put` returns as evicted.
 */
class BackgroundApps {
  /** @param {{ max?: number }} [options] */
  constructor({ max = DEFAULT_MAX } = {}) {
    if (!Number.isInteger(max) || max < MIN_MAX || max > MAX_MAX) throw new RangeError(`max must be an integer from ${MIN_MAX} to ${MAX_MAX}`);
    this.max = max;
    this.order = [];
  }

  /** Ids in background order, oldest first. */
  list() { return [...this.order]; }

  has(id) { return this.order.includes(id); }

  /** Adds an app to the background. Re-adding an app moves it to the newest end. Returns the ids evicted to respect the limit (oldest first). */
  put(id) {
    if (typeof id !== 'string' || !id) throw new TypeError('background app id must be a non-empty string');
    this.order = this.order.filter((existing) => existing !== id);
    this.order.push(id);
    const evicted = [];
    while (this.order.length > this.max) evicted.push(this.order.shift());
    return evicted;
  }

  /** Removes an app because it was resumed or closed. Returns true when it was in the background. */
  take(id) {
    const index = this.order.indexOf(id);
    if (index === -1) return false;
    this.order.splice(index, 1);
    return true;
  }

  /** Changes the limit (from settings). Returns the ids evicted when the new limit is smaller. */
  setMax(max) {
    if (!Number.isInteger(max) || max < MIN_MAX || max > MAX_MAX) throw new RangeError(`max must be an integer from ${MIN_MAX} to ${MAX_MAX}`);
    this.max = max;
    const evicted = [];
    while (this.order.length > this.max) evicted.push(this.order.shift());
    return evicted;
  }

  clear() { const all = this.order; this.order = []; return all; }
}

module.exports = { BackgroundApps, backgroundLimit, validateBackgroundApps, DEFAULT_MAX, MIN_MAX, MAX_MAX };
