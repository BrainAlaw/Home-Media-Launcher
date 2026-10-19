// Form-to-settings logic for the structured object editors (soloist, backgroundApps, homeHeader, remote, vpn, wallpaper).
// Field specs come from /api/settings-description (OBJECT_FIELDS); the browser never loads object-fields.js.
// The server validates again on PUT /api/config, so the rules here only give immediate feedback.
(function () {
  'use strict';

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /** Converts one stored value into the raw form state: booleans, strings (lists as lines). */
  function rawFromValue(spec, value) {
    switch (spec.type) {
      case 'boolean':
        return value === true;
      case 'list':
        return Array.isArray(value) ? value.join('\n') : '';
      case 'number':
        return typeof value === 'number' ? String(value) : '';
      default:
        return value === undefined || value === null ? '' : String(value);
    }
  }

  /** Builds the raw form state for every field of one object. */
  function draftFromObject(fields, object) {
    const source = isPlainObject(object) ? object : {};
    const draft = {};
    for (const spec of fields) draft[spec.key] = rawFromValue(spec, source[spec.key]);
    return draft;
  }

  /** Converts raw form state back into the stored type. Numbers that are not numeric become NaN and fail validation. */
  function valueFromRaw(spec, raw) {
    switch (spec.type) {
      case 'boolean':
        return raw === true;
      case 'number': {
        const text = String(raw ?? '').trim();
        return text === '' ? NaN : Number(text);
      }
      case 'list':
        return String(raw ?? '').split('\n').map((item) => item.trim()).filter((item) => item !== '');
      default:
        return String(raw ?? '');
    }
  }

  /** Returns the message for an invalid value, or an empty string. Mirrors validateFieldValue in object-fields.js. */
  function validateValue(spec, value) {
    switch (spec.type) {
      case 'boolean':
        return typeof value === 'boolean' ? '' : 'Choose on or off.';
      case 'text':
        if (typeof value !== 'string') return 'Enter text.';
        if (spec.maxLength !== undefined && value.length > spec.maxLength) return `Use at most ${spec.maxLength} characters.`;
        if (/[\x00-\x1f]/.test(value)) return 'Remove control characters.';
        return '';
      case 'enum':
        return spec.options.includes(value) ? '' : 'Choose one of the listed options.';
      case 'number':
        return Number.isInteger(value) && value >= spec.min && value <= spec.max
          ? ''
          : `Enter a whole number from ${spec.min} to ${spec.max}.`;
      case 'list':
        return Array.isArray(value) && value.every((item) => typeof item === 'string' && !item.includes('\0'))
          ? ''
          : 'Each entry must be text without null characters.';
      default:
        return 'Unsupported field type.';
    }
  }

  /**
   * Merges the typed draft values over the stored object, so keys the editor does not show are kept.
   * @returns {{ object: object, errors: Record<string, string> }} errors maps field keys to messages; save only when it is empty.
   */
  function buildObject(fields, base, draft) {
    const object = { ...(isPlainObject(base) ? base : {}) };
    const errors = {};
    for (const spec of fields) {
      const value = valueFromRaw(spec, draft?.[spec.key]);
      object[spec.key] = value;
      const message = validateValue(spec, value);
      if (message) errors[spec.key] = message;
    }
    return { object, errors };
  }

  /** The request body for PUT /api/config: the whole object, under its settings key. */
  function patchFor(objectName, object) {
    return { settings: { [objectName]: object } };
  }

  /** Returns the field key a server message names (for example "deviceName must be ..."), or null when none does. */
  function fieldForServerError(message, fields) {
    if (typeof message !== 'string') return null;
    const words = new Set(message.split(/[^A-Za-z0-9_]+/));
    const match = fields.find((spec) => words.has(spec.key));
    return match ? match.key : null;
  }

  window.AdminObjectEditorModel = Object.freeze({
    draftFromObject, valueFromRaw, validateValue, buildObject, patchFor, fieldForServerError
  });
}());
