'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAge, describeHost } = require('../src/renderer/home-sections');
const { buildHostInfo, withHostDefaults, defaultCredential, bareHost } = require('../src/main/ext/remote');

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

test('relative age is compact and monotonic', () => {
  assert.equal(formatAge(NOW - 10_000, NOW), 'just now');
  assert.equal(formatAge(NOW - 5 * 60_000, NOW), '5 min ago');
  assert.equal(formatAge(NOW - 3 * 3_600_000, NOW), '3 h ago');
  assert.equal(formatAge(NOW - 5 * 86_400_000, NOW), '5 d ago');
  assert.equal(formatAge(undefined, NOW), '');
});

test('host badge view hides when disabled and labels every live state', () => {
  assert.equal(describeHost({ hostname: 'pc', ip: '', status: 'disabled' }, NOW).hidden, true);
  assert.equal(describeHost(null, NOW).hidden, true);
  const view = describeHost({ hostname: 'gaming-pc', ip: '192.168.1.10', status: 'cached', lastSyncAt: NOW - 120_000 }, NOW);
  assert.deepEqual(view, { hidden: false, state: 'cached', name: 'gaming-pc', ip: '192.168.1.10', statusLabel: 'Cached', syncLabel: 'Synced 2 min ago' });
  assert.equal(describeHost({ hostname: '', ip: '10.0.0.2', status: 'online' }, NOW).ip, '');
});

test('host info falls back to environment defaults and never exposes the API key', () => {
  const secrets = { vibepolloHost: 'gaming-pc', vibepolloIp: '192.168.1.10', vibepolloApiKey: 'secret-key' };
  const info = buildHostInfo({ remote: { enabled: true, host: '' }, secrets, status: { status: 'online', updatedAt: '2026-01-01T11:00:00.000Z' } });
  assert.deepEqual(info, { hostname: 'gaming-pc', ip: '192.168.1.10', status: 'online', lastSyncAt: Date.parse('2026-01-01T11:00:00.000Z') });
  assert.ok(!JSON.stringify(info).includes('secret-key'));
  assert.equal(buildHostInfo({ remote: { enabled: false, host: 'x' }, secrets: {} }).status, 'disabled');
  assert.equal(buildHostInfo({ remote: { enabled: true, host: 'https://10.0.0.5:47990/api' }, secrets: {} }).ip, '10.0.0.5');
  assert.equal(buildHostInfo({ remote: { enabled: true, host: 'box' }, secrets: {}, status: { status: 'offline' } }).status, 'offline');
});

test('config values win over environment defaults', () => {
  const secrets = { vibepolloHost: 'env-host', vibepolloApiKey: 'env-key' };
  assert.equal(withHostDefaults({ host: 'cfg-host' }, secrets).host, 'cfg-host');
  assert.equal(withHostDefaults({ host: ' ' }, secrets).host, 'env-host');
  assert.equal(defaultCredential('stored', secrets), 'stored');
  assert.equal(defaultCredential('', secrets), 'env-key');
  assert.equal(bareHost('http://[::1]:80/x'), '::1');
});
