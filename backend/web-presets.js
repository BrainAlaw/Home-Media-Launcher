'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PRESET_DIRECTORY = path.join(__dirname, '..', 'src', 'renderer', 'icons', 'presets');

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

/** Presets that are added to a fresh configuration. */
const FIRST_RUN_PRESET_IDS = Object.freeze(['netflix', 'youtube', 'spotify', 'disney-plus', 'prime-video', 'twitch']);

function iconFile(preset) { return path.join(PRESET_DIRECTORY, `${preset.id}.svg`); }

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

/** Matches the config.json `websites[]` schema ({ id, name, url, icon }) validated in src/main/config.js. */
function presetToWebsite(preset) {
  if (!preset || typeof preset.id !== 'string' || typeof preset.name !== 'string' || typeof preset.url !== 'string') throw new Error('Invalid web preset');
  return { id: `preset:${preset.id}`, name: preset.name, url: preset.url, icon: preset.icon || '' };
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

module.exports = { PRESET_DIRECTORY, FIRST_RUN_PRESET_IDS, listPresets, getPreset, matchPresetByHostname, presetToWebsite, addPresetWebsites, firstRunWebsites };
