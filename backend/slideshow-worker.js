'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');

const budget = workerData.budget;
const fullLimit = Math.min(workerData.fullLimit, budget);
const headBytes = Math.min(workerData.headBytes, Math.floor(budget / 2));
const tailBytes = Math.min(workerData.tailBytes, Math.floor(budget / 4));
const cache = new Map();
let bytes = 0;
let wanted = new Map();
let pending = [];
let running = false;
let generation = 0;

function remove(token) {
  const record = cache.get(token);
  if (!record) return;
  bytes -= record.bytes;
  cache.delete(token);
  parentPort.postMessage({ type: 'evicted', token, bytes });
}

async function load(asset) {
  let handle;
  try {
    handle = await fs.open(asset.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Not a regular file');
    const previous = cache.get(asset.token);
    if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
      cache.delete(asset.token);
      cache.set(asset.token, previous);
      return;
    }
    if (previous) remove(asset.token);
    if (!stat.size || (asset.kind !== 'video' && stat.size > fullLimit)) throw new Error('Asset exceeds the memory entry limit');
    const ranges = stat.size <= fullLimit
      ? [{ start: 0, length: stat.size }]
      : [{ start: 0, length: Math.min(headBytes, stat.size) }, { start: Math.max(headBytes, stat.size - tailBytes), length: Math.min(tailBytes, Math.max(0, stat.size - headBytes)) }].filter((range) => range.length > 0);
    const required = ranges.reduce((sum, range) => sum + range.length, 0);
    for (const token of cache.keys()) {
      if (bytes + required <= budget) break;
      if (!wanted.has(token)) remove(token);
    }
    if (bytes + required > budget) throw new Error('Prefetch memory budget exhausted');
    const segments = [];
    for (const range of ranges) {
      const buffer = new SharedArrayBuffer(range.length);
      const view = Buffer.from(buffer);
      let offset = 0;
      while (offset < range.length) {
        if (!wanted.has(asset.token)) return;
        const count = Math.min(256 * 1024, range.length - offset);
        const result = await handle.read(view, offset, count, range.start + offset);
        if (!result.bytesRead) throw new Error('Media changed during prefetch');
        offset += result.bytesRead;
      }
      segments.push({ start: range.start, buffer });
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || !wanted.has(asset.token)) return;
    const record = { token: asset.token, size: stat.size, mtimeMs: stat.mtimeMs, segments, bytes: required, complete: stat.size <= fullLimit };
    cache.set(asset.token, record);
    bytes += required;
    parentPort.postMessage({ type: 'cached', record, bytes });
  } catch {
    if (wanted.has(asset.token)) parentPort.postMessage({ type: 'unavailable', token: asset.token, bytes });
  } finally { await handle?.close().catch(() => {}); }
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (pending.length) {
      const asset = pending.shift();
      if (wanted.has(asset.token)) await load(asset);
    }
    parentPort.postMessage({ type: 'settled', generation, bytes });
  } catch { /* Individual loads report their own failures. */ } finally { running = false; }
}

parentPort.on('message', (message) => {
  generation = message.generation;
  wanted = new Map(message.assets.map((asset) => [asset.token, asset]));
  pending = [...wanted.values()];
  // Evict unused entries before allocating new buffers, including in-flight reservations.
  for (const token of cache.keys()) if (!wanted.has(token)) remove(token);
  void drain();
});
