'use strict';

const schema = require('./themes.schema.json');
const { FONTS } = require('../src/renderer/theme');

/** Validate the JSON Schema vocabulary used by themes.schema.json without coercion. */
function validate(value, rule, location = 'theme', root = schema) {
  if (rule.$ref) return validate(value, root.$defs[rule.$ref.split('/').pop()], location, root);
  if (rule.allOf) for (const candidate of rule.allOf) validate(value, candidate, location, root);
  if (rule.oneOf) {
    let matches = 0;
    for (const candidate of rule.oneOf) {
      try { validate(value, candidate, location, root); matches++; } catch { /* Try the next disjoint variant. */ }
    }
    if (matches !== 1) throw new Error(`${location} must match exactly one supported variant`);
  }
  if (Object.hasOwn(rule, 'const') && value !== rule.const) throw new Error(`${location} has an unsupported value`);
  if (rule.enum && !rule.enum.includes(value)) throw new Error(`${location} has an unsupported value`);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (rule.type && !(Array.isArray(rule.type) ? rule.type : [rule.type]).includes(type)) throw new Error(`${location} has an invalid type`);
  if (type === 'string') {
    const length = [...value].length;
    if (length < (rule.minLength ?? 0) || length > (rule.maxLength ?? Infinity) || (rule.pattern && !new RegExp(rule.pattern).test(value))) throw new Error(`${location} is invalid`);
  }
  if (type === 'number' && (!Number.isFinite(value) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity))) throw new Error(`${location} is out of range`);
  if (type === 'number' && rule.multipleOf && value % rule.multipleOf !== 0) throw new Error(`${location} must be an integer`);
  if (type === 'array') {
    if (value.length < (rule.minItems ?? 0) || value.length > (rule.maxItems ?? Infinity)) throw new Error(`${location} has an invalid number of entries`);
    if (rule.items) value.forEach((item, index) => validate(item, rule.items, `${location}[${index}]`, root));
  }
  if (type === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${location} must be a JSON object`);
    const keys = Object.keys(value);
    if (keys.length > (rule.maxProperties ?? Infinity)) throw new Error(`${location} has too many properties`);
    for (const key of rule.required || []) if (!Object.hasOwn(value, key)) throw new Error(`${location}.${key} is required`);
    for (const key of keys) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`${location} contains an unsafe key`);
      if (rule.propertyNames) validate(key, rule.propertyNames, `${location} property name`, root);
      if (Object.hasOwn(rule.properties || {}, key)) validate(value[key], rule.properties[key], `${location}.${key}`, root);
      else if (rule.additionalProperties === false) throw new Error(`${location}.${key} is not supported`);
      else if (typeof rule.additionalProperties === 'object') validate(value[key], rule.additionalProperties, `${location}.${key}`, root);
    }
  }
  return value;
}

/** @param {unknown} theme @returns {import('./contracts').Theme} */
function validateTheme(theme) {
  validate(theme, schema.$defs.theme);
  if (!theme.name.trim()) throw new Error('Theme name cannot be blank');
  if (theme.fontId !== undefined && !FONTS.some((font) => font.id === theme.fontId)) throw new Error('Theme fontId is not a bundled font');
  return theme;
}

/** @param {unknown} state @returns {import('./contracts').ThemeStoreDocument} */
function validateThemeStore(state) {
  validate(state, schema, 'themes');
  state.themes.forEach(validateTheme);
  const ids = new Set(state.themes.map((theme) => theme.id));
  if (ids.size !== state.themes.length) throw new Error('Theme IDs must be unique');
  if (!ids.has(state.currentThemeId)) throw new Error('The current theme must exist');
  return state;
}

module.exports = { validateTheme, validateThemeStore, validateJsonSchema: (value, root) => validate(value, root, 'configuration', root) };
