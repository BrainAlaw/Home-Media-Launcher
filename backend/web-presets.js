'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PRESET_DIRECTORY = path.join(__dirname, '..', 'src', 'renderer', 'icons', 'presets');
const ICON_TOKEN = /^preset:([a-z0-9-]+)$/;
const BUNDLED_ICON_URL = /\/icons\/presets\/([a-z0-9-]+)\.svg(?:[?#].*)?$/i;

/** `hosts` lists every hostname suffix that identifies the service (used by the icon resolver). */
const PRESET_DEFINITIONS = Object.freeze([
  { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/', category: 'video', color: '#E50914', hosts: ['netflix.com'] },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/tv', category: 'video', color: '#FF0000', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'youtube-music', name: 'YouTube Music', url: 'https://music.youtube.com/', category: 'music', color: '#212121', hosts: ['music.youtube.com'] },
  { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/', category: 'music', color: '#1DB954', hosts: ['spotify.com'] },
  { id: 'disney-plus', name: 'Disney+', url: 'https://www.disneyplus.com/', category: 'video', color: '#113CCF', hosts: ['disneyplus.com'] },
  { id: 'prime-video', name: 'Prime Video', url: 'https://www.primevideo.com/', category: 'video', color: '#00A8E1', hosts: ['primevideo.com'] },
  { id: 'max', name: 'Max', url: 'https://www.max.com/', category: 'video', color: '#002BE7', hosts: ['max.com', 'hbomax.com'] },
  { id: 'twitch', name: 'Twitch', url: 'https://www.twitch.tv/', category: 'video', color: '#9146FF', hosts: ['twitch.tv'] },
  { id: 'plex', name: 'Plex', url: 'https://app.plex.tv/', category: 'video', color: '#1F1F1F', hosts: ['plex.tv'] },
  { id: 'jellyfin', name: 'Jellyfin', url: 'http://localhost:8096/', category: 'video', color: '#101820', hosts: ['jellyfin.org'] },
  { id: 'apple-tv-plus', name: 'Apple TV+', url: 'https://tv.apple.com/', category: 'video', color: '#000000', hosts: ['tv.apple.com'] },
  { id: 'player', name: 'Player', url: 'https://player.pl/', category: 'video', color: '#FF5A00', hosts: ['player.pl'] },
  { id: 'canal-plus', name: 'Canal+', url: 'https://www.canalplus.com/', category: 'video', color: '#111111', hosts: ['canalplus.com', 'canalplus.pl'] },
  { id: 'skyshowtime', name: 'SkyShowtime', url: 'https://www.skyshowtime.com/', category: 'video', color: '#2B1B6B', hosts: ['skyshowtime.com'] },
  { id: 'crunchyroll', name: 'Crunchyroll', url: 'https://www.crunchyroll.com/', category: 'video', color: '#F47521', hosts: ['crunchyroll.com'] },
  { id: 'tidal', name: 'Tidal', url: 'https://listen.tidal.com/', category: 'music', color: '#000000', hosts: ['tidal.com'] }
]);

/**
 * Where each service's own icon is fetched from at runtime (see backend/ICONS.md for the verified
 * results). `pages` are scanned for apple-touch-icon / manifest / icon links, `assets` are direct
 * official URLs tried as well. `mono` is the monogram of the fallback tile. Services that block bots
 * or only offer favicons below 128 px simply use the monogram tile.
 */
const ICON_SOURCES = Object.freeze({
  netflix: { mono: 'N' },
  youtube: { mono: 'YT' },
  'youtube-music': { mono: 'YM' },
  spotify: { assets: ['https://www.spotify.com/apple-touch-icon.png'], mono: 'S' },
  'disney-plus': { mono: 'D+' },
  'prime-video': { mono: 'PV' },
  max: { mono: 'M' },
  twitch: { mono: 'T' },
  plex: { mono: 'P' },
  jellyfin: { pages: ['https://jellyfin.org/'], mono: 'J' },
  'apple-tv-plus': { mono: 'TV+' },
  player: { mono: 'P' },
  'canal-plus': { mono: 'C+' },
  skyshowtime: { mono: 'S' },
  crunchyroll: { mono: 'CR' },
  tidal: { mono: 'T' }
});

/** Presets that are added to a fresh configuration. */
const FIRST_RUN_PRESET_IDS = Object.freeze(['netflix', 'youtube', 'spotify', 'disney-plus', 'prime-video', 'twitch']);

function iconFile(preset) { return path.join(PRESET_DIRECTORY, `${preset.id}.svg`); }

/** Internal view for the icon service: definition plus fetch sources (never sent to the renderer). */
function getPresetSources(id) {
  const preset = PRESET_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!preset) return null;
  const extra = ICON_SOURCES[id] || {};
  return { id, name: preset.name, color: preset.color, mono: extra.mono, pages: extra.pages || [new URL(preset.url).origin + '/'], assets: extra.assets || [] };
}

function toPublic(preset) {
  return { id: preset.id, name: preset.name, url: preset.url, icon: pathToFileURL(iconFile(preset)).href, color: preset.color, category: preset.category };
}

/** @returns {import('./contracts').WebPreset[]} */
function listPresets() { return PRESET_DEFINITIONS.map(toPublic); }

function getPreset(id) {
  const preset = PRESET_DEFINITIONS.find((candidate) => candidate.id === id);
  return preset ? toPublic(preset) : null;
}

/** Longest matching host suffix wins, so music.youtube.com beats youtube.com. */
function matchPresetByHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  let best = null;
  let bestLength = 0;
  for (const preset of PRESET_DEFINITIONS) {
    for (const suffix of preset.hosts) {
      if ((host === suffix || host.endsWith(`.${suffix}`)) && suffix.length > bestLength) { best = preset; bestLength = suffix.length; }
    }
  }
  return best ? toPublic(best) : null;
}

/** Home category of a preset: streaming video and music services both live in Home Theatre. */
function presetHomeCategory() { return 'theatre'; }

/** Matches the config.json `websites[]` schema ({ id, name, url, icon, category }) validated in src/main/config.js. */
function presetToWebsite(preset) {
  if (!preset || typeof preset.id !== 'string' || typeof preset.name !== 'string' || typeof preset.url !== 'string') throw new Error('Invalid web preset');
  // The icon is an install-path independent token; the renderer / icon service resolves it at runtime.
  return { id: `preset:${preset.id}`, name: preset.name, url: preset.url, icon: `preset:${preset.id}`, category: presetHomeCategory(preset) };
}

/** Preset id for an icon value: a `preset:<id>` token or a legacy absolute bundled-icon URL / path; otherwise null. */
function presetIdFromIcon(icon) {
  if (typeof icon !== 'string') return null;
  const token = ICON_TOKEN.exec(icon);
  if (token) return token[1];
  const legacy = BUNDLED_ICON_URL.exec(icon.split(String.fromCharCode(92)).join('/'));
  return legacy ? legacy[1] : null;
}

/**
 * Rewrites legacy absolute file URLs of bundled preset icons (stored by earlier versions, tied to the
 * install path) to `preset:<id>` tokens. Returns the same array instance when nothing changed.
 */
function migratePresetIcons(websites) {
  if (!Array.isArray(websites)) return websites;
  let changed = false;
  const result = websites.map((site) => {
    const id = site && typeof site.icon === 'string' && !ICON_TOKEN.test(site.icon) ? presetIdFromIcon(site.icon) : null;
    if (!id || !getPreset(id)) return site;
    changed = true;
    return { ...site, icon: `preset:${id}` };
  });
  return changed ? result : websites;
}

/**
 * Appends the requested presets to an existing `websites` array without duplicating entries
 * (same preset id). Returns a new array; unknown ids are ignored.
 */
function addPresetWebsites(websites, presetIds) {
  const result = Array.isArray(websites) ? [...websites] : [];
  const present = new Set(result.map((site) => site?.id));
  for (const id of presetIds || []) {
    const preset = getPreset(id);
    if (!preset) continue;
    const website = presetToWebsite(preset);
    if (present.has(website.id)) continue;
    present.add(website.id);
    result.push(website);
  }
  return result;
}

/** Websites for a brand-new configuration (`config.websites` is empty/undefined). */
function firstRunWebsites() { return addPresetWebsites([], FIRST_RUN_PRESET_IDS); }

module.exports = { PRESET_DIRECTORY, FIRST_RUN_PRESET_IDS, listPresets, getPreset, getPresetSources, presetIdFromIcon, migratePresetIcons, matchPresetByHostname, presetToWebsite, addPresetWebsites, firstRunWebsites };
