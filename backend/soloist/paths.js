'use strict';

const os = require('node:os');
const path = require('node:path');

const DEFAULT_BINARY = 'soloist';

function absoluteOr(value, fallback) {
  return typeof value === 'string' && path.isAbsolute(value) ? value : fallback;
}

/**
 * Soloist's own defaults (`~/.local/share/soloist`, `~/.cache/soloist`, honouring XDG overrides), so that a
 * pairing made with a manual run is reused. Pass the results as `dataDir` / `cacheDir` to `SoloistProcess.start()`.
 */
function defaultDirectories({ env = process.env, homedir = os.homedir() } = {}) {
  const dataHome = absoluteOr(env.XDG_DATA_HOME, path.join(homedir, '.local', 'share'));
  const cacheHome = absoluteOr(env.XDG_CACHE_HOME, path.join(homedir, '.cache'));
  return Object.freeze({
    dataDir: path.join(dataHome, 'soloist'),
    cacheDir: path.join(cacheHome, 'soloist')
  });
}

/** Resolves `settings.soloist.binaryPath`, falling back to `soloist` on PATH. */
function resolveBinaryPath(setting) {
  const text = typeof setting === 'string' ? setting.trim() : '';
  return text || DEFAULT_BINARY;
}

module.exports = { defaultDirectories, resolveBinaryPath, DEFAULT_BINARY };
