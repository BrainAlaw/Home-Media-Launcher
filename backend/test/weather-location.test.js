'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { WeatherService, parseLocationQuery, pickPlace } = require('../weather');

test('parseLocationQuery splits name and country', () => {
  assert.deepEqual(parseLocationQuery('High Wycombe,GB'), { name: 'High Wycombe', country: 'GB', query: 'High Wycombe,GB' });
  assert.deepEqual(parseLocationQuery(' Paris , fr '), { name: 'Paris', country: 'FR', query: 'Paris,FR' });
  assert.deepEqual(parseLocationQuery('London'), { name: 'London', country: '', query: 'London' });
  assert.equal(parseLocationQuery('Washington, District of Columbia').country, '');
});

test('pickPlace prefers the exact name and country', () => {
  const places = [
    { name: 'Wycombe', lat: 1, lon: 1, country: 'GB' },
    { name: 'High Wycombe', lat: 2, lon: 2, country: 'AU' },
    { name: 'High Wycombe', lat: 51.63, lon: -0.75, country: 'GB' }
  ];
  assert.equal(pickPlace(places, { name: 'High Wycombe', country: 'GB' }).lat, 51.63);
  assert.equal(pickPlace(places, { name: 'high wycombe', country: 'AU' }).lat, 2);
  assert.equal(pickPlace(places, { name: 'Nowhere', country: 'GB' }).name, 'Wycombe');
  assert.equal(pickPlace([], { name: 'x', country: '' }), null);
  // Open-Meteo field names
  assert.equal(pickPlace([{ name: 'A', latitude: 3, longitude: 4, country_code: 'GB' }], { name: 'A', country: 'GB' }).latitude, 3);
});

test('explicit location is geocoded as q=name,country and cached coordinates are reused', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weather-loc-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const body = url.pathname.includes('geo')
      ? [{ name: 'High Wycombe', lat: 51.63, lon: -0.75, country: 'GB' }]
      : url.pathname.endsWith('/weather')
        ? { name: 'High Wycombe', timezone: 3600, main: { temp: 9.4, feels_like: 7.9 }, weather: [{ description: 'scattered clouds', icon: '03d' }] }
        : { city: { timezone: 3600 }, list: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  let clock = 1000;
  const service = new WeatherService({ userData: directory, apiKey: 'K', fetchImpl, now: () => clock });
  const snapshot = await service.get('High Wycombe,GB');
  assert.equal(snapshot.location, 'High Wycombe');
  assert.equal(snapshot.temperature, 9);
  assert.equal(snapshot.condition, 'Scattered clouds');
  const geo = urls.find((url) => url.pathname.includes('geo'));
  assert.equal(geo.searchParams.get('q'), 'High Wycombe,GB');
  assert.equal(urls.find((url) => url.pathname.endsWith('/weather')).searchParams.get('units'), 'metric');
  clock += 11 * 60 * 1000;
  urls.length = 0;
  await service.get('High Wycombe, GB');
  assert.equal(urls.filter((url) => url.pathname.includes('geo')).length, 0, 'second refresh skips geocoding');
  assert.equal(urls.length, 2);
});

test('empty location is rejected without any network call (no built-in default, no IP lookup)', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weather-empty-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const service = new WeatherService({ userData: directory, apiKey: 'K', fetchImpl: async () => { calls += 1; throw new Error('unexpected'); } });
  for (const value of ['', '   ', undefined]) await assert.rejects(() => service.get(value), /not set/);
  assert.equal(calls, 0);
});
