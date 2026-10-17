'use strict';

const path = require('node:path');
const { atomicWrite, readJson, serialize } = require('./storage');

const API = 'https://api.openweathermap.org';
const FRESH_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 6000;
const MAX_CACHE_ENTRIES = 12;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Keeps only the OpenWeatherMap icon codes the renderer bundles (01-04, 09-11, 13, 50 with d/n). */
function sanitizeIcon(icon) {
  return /^(01|02|03|04|09|10|11|13|50)[dn]$/.test(icon) ? icon : '03d';
}

/** Capitalises the first letter of the provider's condition text. */
function titleCase(text) {
  const value = String(text || '').trim();
  return value ? value[0].toUpperCase() + value.slice(1) : 'Unknown';
}

/** Groups the 3-hourly forecast into local calendar days using the city's UTC offset (seconds). */
function summariseForecast(list, timezone = 0, days = 5) {
  const groups = new Map();
  for (const entry of Array.isArray(list) ? list : []) {
    if (!Number.isFinite(entry?.dt) || !Number.isFinite(entry?.main?.temp)) continue;
    const local = new Date((entry.dt + timezone) * 1000);
    const key = local.toISOString().slice(0, 10);
    const hour = local.getUTCHours();
    const group = groups.get(key) || { day: DAY_NAMES[local.getUTCDay()], min: Infinity, max: -Infinity, icon: null, distance: Infinity };
    group.min = Math.min(group.min, entry.main.temp_min ?? entry.main.temp);
    group.max = Math.max(group.max, entry.main.temp_max ?? entry.main.temp);
    const distance = Math.abs(hour - 13);
    if (distance < group.distance) { group.distance = distance; group.icon = sanitizeIcon(String(entry.weather?.[0]?.icon || '').replace(/n$/, 'd')); }
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, days)
    .map(([, group]) => ({ day: group.day, min: Math.round(group.min), max: Math.round(group.max), icon: group.icon || '03d' }));
}

/** Builds the WeatherSnapshot contract from OpenWeatherMap `weather` and `forecast` payloads. */
function buildSnapshot(place, current, forecast, now = Date.now()) {
  const temperature = current?.main?.temp;
  if (!Number.isFinite(temperature)) throw new Error('Weather response is missing the temperature');
  return {
    location: String(place?.name || current?.name || ''),
    temperature: Math.round(temperature),
    feelsLike: Math.round(Number.isFinite(current.main.feels_like) ? current.main.feels_like : temperature),
    condition: titleCase(current.weather?.[0]?.description),
    icon: sanitizeIcon(String(current.weather?.[0]?.icon || '')),
    forecast: summariseForecast(forecast?.list, forecast?.city?.timezone ?? current?.timezone ?? 0),
    fetchedAt: now
  };
}

const cacheKey = (location) => String(location).trim().toLowerCase();

class WeatherService {
  /**
   * @param {{ userData: string, apiKey: string, fetchImpl?: typeof fetch, now?: () => number }} options
   */
  constructor({ userData, apiKey, fetchImpl = globalThis.fetch, now = Date.now }) {
    this.file = path.join(userData, 'weather-cache.json');
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.now = now;
  }

  get available() { return Boolean(this.apiKey); }

  /** The API key travels in the query string, so errors must never echo the request URL. */
  async request(endpoint, params) {
    const url = new URL(endpoint, API);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    url.searchParams.set('appid', this.apiKey);
    let response;
    try { response = await this.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch { throw new Error('Weather service unreachable'); }
    if (response.status === 401) throw new Error('Weather API key rejected');
    if (!response.ok) throw new Error(`Weather service error ${response.status}`);
    return response.json();
  }

  async readCache() { return (await readJson(this.file, {})) || {}; }

  async writeCache(key, snapshot) {
    await serialize(this.file, async () => {
      const cache = await this.readCache();
      cache[key] = snapshot;
      const keep = Object.entries(cache).sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt).slice(0, MAX_CACHE_ENTRIES);
      await atomicWrite(this.file, JSON.stringify(Object.fromEntries(keep)));
    });
  }

  /** Fresh cache hit, else live fetch, else stale cache. Rejects only when nothing is available at all. */
  async get(location) {
    if (!this.available) throw new Error('Weather API key is not configured');
    const text = typeof location === 'string' ? location.trim() : '';
    if (!text || text.length > 80) throw new Error('Invalid weather location');
    const key = cacheKey(text);
    const cached = (await this.readCache().catch(() => ({})))[key];
    if (cached && this.now() - cached.fetchedAt < FRESH_MS) return cached;
    try {
      const places = await this.request('/geo/1.0/direct', { q: text, limit: 1 });
      const place = Array.isArray(places) ? places[0] : null;
      if (!place) throw new Error('Location not found');
      const where = { lat: place.lat, lon: place.lon, units: 'metric' };
      const [current, forecast] = await Promise.all([this.request('/data/2.5/weather', where), this.request('/data/2.5/forecast', where)]);
      const snapshot = buildSnapshot(place, current, forecast, this.now());
      await this.writeCache(key, snapshot).catch(() => {});
      return snapshot;
    } catch (error) {
      if (cached) return cached;
      throw error;
    }
  }
}

module.exports = { WeatherService, buildSnapshot, summariseForecast, sanitizeIcon, titleCase };
