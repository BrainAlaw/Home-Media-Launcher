'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadToken, saveToken } = require('../src/main/secret-store');

test('stores token only in encrypted form', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-secret-'));
  const filePath = path.join(directory, 'token.json');
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace('encrypted:', '')
  };
  await saveToken(filePath, 'secret-value', safeStorage);
  assert.doesNotMatch(await fs.readFile(filePath, 'utf8'), /secret-value/);
  assert.equal(await loadToken(filePath, safeStorage), 'secret-value');
});
