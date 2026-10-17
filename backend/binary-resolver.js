'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function isExecutable(file, platform) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    if (platform !== 'win32') await fs.access(file, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

/**
 * Resolves a command to an absolute executable path without spawning anything.
 * Returns null when the binary cannot be found, so callers can report a precise error.
 */
async function resolveBinary(command, { platform = process.platform, env = process.env } = {}) {
  if (typeof command !== 'string' || !command) return null;
  const pathExt = (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean);
  const hasKnownExtension = pathExt.some((ext) => command.toLowerCase().endsWith(ext.toLowerCase()));
  // Extensionless Windows files (npm shims, unix scripts) are not executable, so PATHEXT candidates win.
  const extensions = platform !== 'win32' || hasKnownExtension ? [''] : pathExt;
  const hasDirectory = command.includes('/') || (platform === 'win32' && command.includes('\\'));
  const directories = hasDirectory || path.isAbsolute(command) ? [''] : (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = directory ? path.join(directory, command + extension) : command + extension;
      if (await isExecutable(candidate, platform)) return path.resolve(candidate);
    }
  }
  return null;
}

const BROWSERS = {
  chromium: {
    linux: ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'brave-browser', 'microsoft-edge'],
    win32: ['chrome.exe', 'msedge.exe', 'brave.exe']
  },
  firefox: { linux: ['firefox'], win32: ['firefox.exe'] }
};

/** Finds the first installed browser of an engine, or returns null. */
async function findBrowser(engine, { platform = process.platform, env = process.env } = {}) {
  const names = BROWSERS[engine]?.[platform === 'win32' ? 'win32' : 'linux'] || [];
  const roots = platform === 'win32'
    ? [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean)
    : [];
  const windowsSubdirectories = ['Google/Chrome/Application', 'Microsoft/Edge/Application', 'BraveSoftware/Brave-Browser/Application', 'Mozilla Firefox'];
  for (const name of names) {
    const found = await resolveBinary(name, { platform, env });
    if (found) return found;
    for (const root of roots) for (const subdirectory of windowsSubdirectories) {
      const candidate = await resolveBinary(path.join(root, subdirectory, name), { platform, env });
      if (candidate) return candidate;
    }
  }
  return null;
}

module.exports = { findBrowser, resolveBinary };
