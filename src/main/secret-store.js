'use strict';

const fs = require('node:fs/promises');
const { atomicWrite, serialize } = require('../../backend/storage');

function assertSecureStorage(safeStorage) {
  if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('Secure credential storage is unavailable');
}

async function saveToken(filePath, token, safeStorage) {
  if (!token) {
    await serialize(filePath, () => fs.rm(filePath, { force: true }));
    return false;
  }
  assertSecureStorage(safeStorage);
  const encrypted = safeStorage.encryptString(token).toString('base64');
  await serialize(filePath, () => atomicWrite(filePath, JSON.stringify({ version: 1, encrypted })));
  return true;
}

async function loadToken(filePath, safeStorage) {
  try {
    assertSecureStorage(safeStorage);
    const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return safeStorage.decryptString(Buffer.from(payload.encrypted, 'base64'));
  } catch { return ''; }
}

async function saveCredential(filePath, credential, safeStorage) {
  if (credential === null) return saveToken(filePath, '', safeStorage);
  if (!credential || credential.type !== 'basic' || typeof credential.username !== 'string' || !credential.username || credential.username.includes(':') || typeof credential.password !== 'string' || !credential.password) throw new Error('Sunshine credentials require a username and password');
  return saveToken(filePath, JSON.stringify({ type: 'basic', username: credential.username, password: credential.password }), safeStorage);
}

async function loadCredential(filePath, safeStorage) {
  const value = await loadToken(filePath, safeStorage);
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type === 'basic') return parsed;
  } catch { /* Legacy bearer tokens are stored as plain strings inside the encrypted payload. */ }
  return value;
}

async function hasToken(filePath) {
  try { await fs.access(filePath); return true; }
  catch { return false; }
}

module.exports = { hasToken, loadToken, saveToken, saveCredential, loadCredential };
