'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { cacheArtwork } = require('./artwork');
const { readJson, atomicWrite, serialize } = require('./storage');

const manifestPath = path.join(workerData.directory, 'context-artwork.json');
const cacheDirectory = path.join(workerData.directory, 'context-artwork');
const queue = [];
let active = 0;
let manifest;

async function processJob(job) {
  const previous = manifest[job.source];
  try {
    if (previous && Date.now() - previous.updatedAt < 86400000) {
      await fs.access(fileURLToPath(previous.url));
      return { record: previous, evicted: [] };
    }
  } catch { /* Rebuild missing cached images. */ }
  let url;
  try { url = await cacheArtwork(job.source, cacheDirectory, job.options); }
  catch (error) {
    if (!previous) throw error;
    await fs.access(fileURLToPath(previous.url));
    return { record: previous, evicted: [] };
  }
  const record = { url, updatedAt: Date.now() };
  manifest[job.source] = record;
  const evicted = [];
  const entries = Object.entries(manifest);
  if (entries.length > 1024) {
    entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [source, old] of entries.slice(0, entries.length - 1024)) {
      delete manifest[source];
      evicted.push(source);
      // Files are content-addressed, so keep any file still referenced by a surviving record.
      if (!Object.values(manifest).some((other) => other.url === old.url)) await removeCached(old.url);
    }
  }
  try { await serialize(manifestPath, () => atomicWrite(manifestPath, JSON.stringify(manifest))); }
  catch { /* A writable cache is optional; downloaded artwork remains usable this session. */ }
  return { record, evicted };
}

async function removeCached(url) {
  try {
    const file = fileURLToPath(url);
    if (path.dirname(file) === path.resolve(cacheDirectory)) await fs.unlink(file);
  } catch { /* Already removed or outside the cache directory. */ }
}

function drain() {
  while (active < 2 && queue.length) {
    const job = queue.shift();
    active++;
    processJob(job).then(({ record, evicted }) => parentPort.postMessage({ id: job.id, record, evicted }),
      () => parentPort.postMessage({ id: job.id, error: 'Context artwork is unavailable' }))
      .finally(() => { active--; drain(); });
  }
}

(async () => {
  const saved = await readJson(manifestPath, {});
  manifest = Object.create(null);
  if (saved && typeof saved === 'object') {
    for (const [source, record] of Object.entries(saved).slice(-1024)) {
      if (typeof record?.url === 'string' && record.url.startsWith('file:') && Number.isFinite(record.updatedAt)) manifest[source] = record;
    }
  }
  parentPort.on('message', (job) => { queue.push(job); drain(); });
  parentPort.postMessage({ ready: true, manifest });
})().catch(() => { parentPort.postMessage({ fatal: 'Context artwork cache could not be initialized' }); });
