'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnv, readSecrets } = require('../backend/env');

test('parseEnv handles comments, quotes and export', () => {
  const values = parseEnv('# c\nVP_IP=10.0.0.2\nexport VP_HOST="gaming-pc"\nWEATHER_API=abc # note\nEMPTY=\n');
  assert.deepEqual(values, { VP_IP: '10.0.0.2', VP_HOST: 'gaming-pc', WEATHER_API: 'abc', EMPTY: '' });
});

test('readSecrets maps env keys', () => {
  const secrets = readSecrets({ VP_API: 'k', STEAMDB_API: 's', WEATHER_API: 'w', VP_IP: '1.1.1.1', VP_HOST: 'h' });
  assert.equal(secrets.steamGridDbKey, 's');
  assert.equal(secrets.vibepolloIp, '1.1.1.1');
});
