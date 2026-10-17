'use strict';

const { createHash } = require('node:crypto');
const { parseOnlineLocation } = require('../src/renderer/wallpaper-sources');

/** Size and count caps for user-supplied online catalogues. */
const MAX_CATALOGUE_BYTES = 1024 * 1024;
const MAX_ENTRIES_PER_SOURCE = 500;
const MAX_FIELD = 200;

/**
 * Credit metadata shown for a wallpaper.
 * @typedef {{ title: string, author: string, license: string, source: string, location: string, origin: 'bundled' | 'online' | 'local' }} WallpaperCredit
 * @typedef {{ id: string, name: string, url: string, thumbUrl: string, author: string, license: string, source: string, location: string, category: string }} CatalogueEntry
 */

/** @param {unknown} value @param {number} [max] */
function cleanText(value, max = MAX_FIELD) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Accepts only plain https URLs on public hosts; returns '' otherwise. */
function cleanUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\//i.test(value.trim())) return '';
  const parsed = parseOnlineLocation(value);
  return parsed.ok ? parsed.location : '';
}

/** Stable id namespace per source so custom catalogues can never collide with built-in entries. */
function entryId(sourceId, rawId, url) {
  const slug = cleanText(rawId, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${sourceId}:${slug || createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
}

/**
 * Validates one catalogue item. Returns null for anything that is not an https image URL on a public host.
 * @param {unknown} raw
 * @param {string} sourceId
 * @returns {CatalogueEntry | null}
 */
function normaliseEntry(raw, sourceId) {
  if (!raw || typeof raw !== 'object') return null;
  const item = /** @type {Record<string, unknown>} */ (raw);
  const url = cleanUrl(item.url);
  if (!url) return null;
  const name = cleanText(item.title ?? item.name) || 'Wallpaper';
  const sourceText = cleanText(item.source, 300);
  return {
    id: entryId(sourceId, item.id ?? name, url),
    name, url,
    thumbUrl: cleanUrl(item.thumbUrl) || '',
    author: cleanText(item.author),
    license: cleanText(item.license ?? item.licence, 60),
    source: sourceText,
    location: cleanText(item.location),
    category: cleanText(item.category, 40)
  };
}

/**
 * Parses a custom online catalogue: a JSON array of items, or `{ name?, wallpapers: [...] }`.
 * @param {Buffer | string} body
 * @param {string} sourceId
 * @returns {{ name: string, entries: CatalogueEntry[] }}
 */
function parseCatalogue(body, sourceId) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  if (Buffer.byteLength(text) > MAX_CATALOGUE_BYTES) throw new Error('Catalogue is larger than 1 MB');
  let parsed;
  try { parsed = JSON.parse(text.replace(/^﻿/, '')); } catch { throw new Error('Catalogue is not valid JSON'); }
  const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.wallpapers) ? parsed.wallpapers : null);
  if (!items) throw new Error('Catalogue must be a list of wallpapers');
  const seen = new Set();
  const entries = [];
  for (const item of items) {
    const entry = normaliseEntry(item, sourceId);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length >= MAX_ENTRIES_PER_SOURCE) break;
  }
  if (!entries.length) throw new Error('Catalogue contains no usable https image addresses');
  return { name: cleanText(parsed?.name, 80), entries };
}

/** Builds the credit shown for an entry; empty fields stay empty so the UI can skip them. */
function creditFor(entry, origin = 'online') {
  return {
    title: cleanText(entry.name), author: cleanText(entry.author), license: cleanText(entry.license, 60),
    source: cleanText(entry.source, 300), location: cleanText(entry.location), origin
  };
}

module.exports = { MAX_CATALOGUE_BYTES, MAX_ENTRIES_PER_SOURCE, parseCatalogue, normaliseEntry, creditFor, cleanText };
