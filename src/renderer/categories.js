(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Categories = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Pure helpers for settings.categories: the ordered list of home sections.
   * @typedef {{ id: string, label: string, builtin?: 'theatre' | 'gaming' }} Category
   */

  const BUILTIN_IDS = Object.freeze(['theatre', 'gaming']);
  const MAX_CATEGORIES = 24;
  const MAX_LABEL = 40;
  const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

  /** @returns {Category[]} fresh copy of the default sections */
  function defaults() {
    return [
      { id: 'theatre', label: 'Home Theatre', builtin: 'theatre' },
      { id: 'gaming', label: 'Gaming', builtin: 'gaming' }
    ];
  }

  /** Lower-case ASCII slug, never empty. */
  function slugify(label) {
    const slug = String(label ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
    return slug || 'category';
  }

  /** First unused id derived from the label (`movies`, `movies-2`, ...). */
  function uniqueId(label, list) {
    const taken = new Set(list.map((category) => category.id));
    const base = slugify(label);
    if (!taken.has(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  const cleanLabel = (label) => String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);

  /**
   * Repairs stored data: drops malformed entries and duplicates, and restores any missing built-in section.
   * @param {unknown} value
   * @returns {Category[]}
   */
  function normalise(value) {
    const out = [];
    const seen = new Set();
    for (const entry of Array.isArray(value) ? value : []) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id) || seen.has(entry.id)) continue;
      const label = cleanLabel(entry.label);
      if (!label) continue;
      seen.add(entry.id);
      out.push(BUILTIN_IDS.includes(entry.id) ? { id: entry.id, label, builtin: entry.id } : { id: entry.id, label });
      if (out.length >= MAX_CATEGORIES) break;
    }
    for (const fallback of defaults()) if (!seen.has(fallback.id)) out.push(fallback);
    return out;
  }

  /** @returns {{ ok: true, list: Category[] } | { ok: false, error: string }} */
  function add(list, label) {
    const clean = cleanLabel(label);
    if (!clean) return { ok: false, error: 'Enter a category name' };
    if (list.length >= MAX_CATEGORIES) return { ok: false, error: `At most ${MAX_CATEGORIES} categories` };
    if (list.some((category) => category.label.toLowerCase() === clean.toLowerCase())) return { ok: false, error: 'A category with that name exists' };
    return { ok: true, list: [...list, { id: uniqueId(clean, list), label: clean }] };
  }

  /** Renames any category (built-in ones keep their id). Empty labels keep the old name. */
  function rename(list, id, label) {
    const clean = cleanLabel(label);
    if (!clean) return list;
    return list.map((category) => (category.id === id ? { ...category, label: clean } : category));
  }

  /** Removes a custom category; built-in sections are never removed. */
  function remove(list, id) {
    return list.filter((category) => category.id !== id || category.builtin);
  }

  /** Moves one entry by `delta` positions, clamped to the list. */
  function move(list, id, delta) {
    const from = list.findIndex((category) => category.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return list;
    const next = [...list];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  }

  /**
   * Strict validation for config.js. Throws on the first problem.
   * @param {unknown} value
   */
  function validate(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CATEGORIES) throw new Error(`categories must be an array of 1 to ${MAX_CATEGORIES} entries`);
    const seen = new Set();
    value.forEach((entry, index) => {
      const where = `categories[${index}]`;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${where} must be an object`);
      if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) throw new Error(`${where}.id must be a lower-case slug`);
      if (seen.has(entry.id)) throw new Error(`${where}.id is duplicated`);
      seen.add(entry.id);
      if (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > MAX_LABEL) throw new Error(`${where}.label must be 1 to ${MAX_LABEL} characters`);
      if (entry.builtin !== undefined && (!BUILTIN_IDS.includes(entry.builtin) || entry.builtin !== entry.id)) throw new Error(`${where}.builtin must match a built-in id`);
    });
    for (const id of BUILTIN_IDS) if (!seen.has(id)) throw new Error(`categories must keep the built-in "${id}" section`);
  }

  return { BUILTIN_IDS, MAX_CATEGORIES, MAX_LABEL, defaults, slugify, uniqueId, normalise, add, rename, remove, move, validate };
});
