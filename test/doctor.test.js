'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { checkEnvKeys, checkPrograms, formatReport } = require('../scripts/doctor.cjs');

const SAMPLE = [
  '# comment line',
  'VP_API=secret123',
  'VP_HOST=',
  'WEATHER_API="weather-key"',
  'SPOTIFY_CLIENT_ID='
].join('\n');

test('checkEnvKeys reports set, empty and missing keys without values', () => {
  const rows = checkEnvKeys(SAMPLE, ['VP_API', 'VP_HOST', 'WEATHER_API', 'STEAMDB_API']);
  assert.deepStrictEqual(rows, [
    { key: 'VP_API', present: true },
    { key: 'VP_HOST', present: false },
    { key: 'WEATHER_API', present: true },
    { key: 'STEAMDB_API', present: false }
  ]);
  assert.ok(!JSON.stringify(rows).includes('secret123'));
  assert.ok(!JSON.stringify(rows).includes('weather-key'));
});

test('checkEnvKeys treats empty text as all missing', () => {
  const rows = checkEnvKeys(undefined, ['VP_API', 'VP_IP']);
  assert.deepStrictEqual(rows, [
    { key: 'VP_API', present: false },
    { key: 'VP_IP', present: false }
  ]);
});

test('checkPrograms resolves names with a fake resolve', async () => {
  const requested = [];
  const resolve = async (name) => {
    requested.push(name);
    return name === 'moonlight' ? '/usr/bin/moonlight' : null;
  };
  const rows = await checkPrograms(['moonlight', 'tailscale'], { resolve, platform: 'linux' });
  assert.deepStrictEqual(rows, [
    { name: 'moonlight', found: true },
    { name: 'tailscale', found: false }
  ]);
  assert.deepStrictEqual(requested, ['moonlight', 'tailscale']);
});

test('checkPrograms marks Linux-only programs unsupported elsewhere and does not resolve them', async () => {
  const requested = [];
  const resolve = async (name) => {
    requested.push(name);
    return '/usr/bin/' + name;
  };
  const rows = await checkPrograms(['soloist', 'nmcli'], { resolve, platform: 'win32' });
  assert.deepStrictEqual(rows, [
    { name: 'soloist', found: false, note: 'not supported on this OS' },
    { name: 'nmcli', found: false, note: 'not supported on this OS' }
  ]);
  assert.deepStrictEqual(requested, []);
});

test('formatReport prints one line per row and never contains a secret value', async () => {
  const envRows = checkEnvKeys(SAMPLE, ['VP_API', 'VP_HOST', 'STEAMDB_API']);
  const programRows = await checkPrograms(['moonlight'], { resolve: async () => '/usr/bin/moonlight', platform: 'linux' });
  const report = formatReport(envRows, programRows);
  const lines = report.split('\n');
  assert.deepStrictEqual(lines, [
    'VP_API: set',
    'VP_HOST: missing',
    'STEAMDB_API: missing',
    'moonlight: found'
  ]);
  assert.ok(!report.includes('secret123'), 'report must never contain .env values');
  assert.ok(!report.includes('weather-key'), 'report must never contain .env values');
});
