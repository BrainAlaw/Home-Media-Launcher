'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const pending = new Map();

async function atomicWrite(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

function serialize(file, operation) {
  const key = path.resolve(file);
  const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, next);
  return next.finally(() => { if (pending.get(key) === next) pending.delete(key); });
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

module.exports = { atomicWrite, readJson, serialize };
