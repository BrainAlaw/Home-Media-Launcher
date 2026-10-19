'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdminPanelFormModel = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function fieldsFor(descriptor, groupKey) {
    const settings = Array.isArray(descriptor?.SETTINGS) ? descriptor.SETTINGS : [];
    return settings.filter((entry) => entry && entry.group === groupKey)
      .map((entry) => ({ ...entry, readOnly: entry.type === 'object' }));
  }

  function valueAt(settings, path) {
    if (typeof path !== 'string' || path.length === 0) return undefined;
    return path.split('.').reduce((value, key) => value == null ? undefined : value[key], settings);
  }

  function withValue(settings, path, value) {
    if (typeof path !== 'string' || path.length === 0 || path.split('.').some((part) => !part)) {
      throw new TypeError('A non-empty dotted setting path is required');
    }
    const parts = path.split('.');
    function update(source, index) {
      const input = source && typeof source === 'object' ? source : {};
      const clone = Array.isArray(input) ? input.slice() : { ...input };
      const key = parts[index];
      clone[key] = index === parts.length - 1 ? value : update(input[key], index + 1);
      return clone;
    }
    return update(settings, 0);
  }

  function validateField(entry, value) {
    let message = '';
    switch (entry?.type) {
      case 'boolean':
        if (typeof value !== 'boolean') message = 'Choose on or off.';
        break;
      case 'text':
        if (typeof value !== 'string') message = 'Enter text.';
        break;
      case 'number': {
        const number = typeof value === 'number' ? value : Number(value);
        const minimum = entry.minimum ?? entry.min;
        const maximum = entry.maximum ?? entry.max;
        if (value === '' || !Number.isFinite(number)) message = 'Enter a valid number.';
        else if (minimum !== undefined && number < minimum) message = `Enter a number of at least ${minimum}.`;
        else if (maximum !== undefined && number > maximum) message = `Enter a number no greater than ${maximum}.`;
        break;
      }
      case 'enum':
        if (!Array.isArray(entry.options) || !entry.options.includes(value)) message = 'This value is not one of the available options.';
        break;
      default:
        break;
    }
    return { valid: message === '', message };
  }

  function equal(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((value, index) => equal(value, b[index]));
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]));
  }

  function changedPaths(before, after) {
    const changes = [];
    function visit(left, right, prefix) {
      if (equal(left, right)) return;
      const bothObjects = left && right && typeof left === 'object' && typeof right === 'object'
        && !Array.isArray(left) && !Array.isArray(right);
      if (!bothObjects) {
        if (prefix) changes.push(prefix);
        return;
      }
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])]) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (!Object.prototype.hasOwnProperty.call(left, key) || !Object.prototype.hasOwnProperty.call(right, key)) changes.push(path);
        else visit(left[key], right[key], path);
      }
    }
    visit(before, after, '');
    return changes;
  }

  return { fieldsFor, valueAt, withValue, validateField, changedPaths };
}));
