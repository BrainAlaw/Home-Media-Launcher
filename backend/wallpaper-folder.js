'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);
const MAX_DEPTH = 2;
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;

function mediaKind(name) {
  const extension = path.extname(String(name || '')).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

/** True when the file name has a supported wallpaper image or video extension. */
function isSupportedMedia(name) { return mediaKind(name) !== null; }

function humanise(file) {
  const base = path.basename(file, path.extname(file)).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return 'Wallpaper';
  return base.replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toLocaleUpperCase());
}

function aborted(signal) {
  if (signal?.aborted) throw new Error('Wallpaper folder scan was cancelled');
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function describeError(error, dir) {
  if (error.code === 'ENOENT') return new Error(`Wallpaper folder does not exist: ${dir}`);
  if (error.code === 'ENOTDIR') return new Error(`Wallpaper path is not a folder: ${dir}`);
  if (error.code === 'EACCES' || error.code === 'EPERM') return new Error(`Permission denied reading wallpaper folder: ${dir}`);
  return new Error(`Cannot read wallpaper folder ${dir}: ${error.message}`);
}

/**
 * Scan an absolute folder (depth <= 2) for wallpaper media. Never blocks the event loop.
 * @returns {Promise<Array<{id:string,name:string,file:string,kind:'image'|'video',size:number}>>}
 */
async function scanFolder(dir, { limit = 2000, signal } = {}) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('Wallpaper folder must be an absolute path');
  const cap = Number.isInteger(limit) && limit > 0 ? limit : 2000;
  let root;
  try {
    root = await fs.realpath(dir);
    if (!(await fs.stat(root)).isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' });
  } catch (error) { throw describeError(error, dir); }

  const found = [];
  async function walk(directory, depth) {
    aborted(signal);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (directory === root) throw describeError(error, dir);
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      aborted(signal);
      if (entry.name.startsWith('.')) continue;
      let full = path.join(directory, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          full = await fs.realpath(full);
          if (!isInside(root, full)) continue;
          const stat = await fs.stat(full);
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
        } catch { continue; }
      }
      if (isDirectory) {
        if (depth < MAX_DEPTH) await walk(full, depth + 1);
        continue;
      }
      if (!isFile) continue;
      const kind = mediaKind(entry.name);
      if (!kind) continue;
      let size;
      try { size = (await fs.stat(full)).size; } catch { continue; }
      if (size <= 0 || size > (kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)) continue;
      const relative = path.relative(root, full).split(path.sep).join('/');
      found.push({
        id: createHash('sha256').update(relative).digest('hex').slice(0, 16),
        name: humanise(entry.name), file: full, kind, size, relative
      });
    }
  }
  await walk(root, 0);
  found.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  return found.slice(0, cap).map(({ relative, ...item }) => item);
}

module.exports = { scanFolder, isSupportedMedia, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS };
