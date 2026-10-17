'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function moonlightCommand(remote, platform = process.platform) {
  const configured = remote.moonlightPath?.trim();
  const prefix = remote.moonlightArgs || [];
  if (!Array.isArray(prefix) || prefix.some((arg) => typeof arg !== 'string')) throw new Error('moonlightArgs must be an array of strings');
  if (configured && configured !== 'moonlight') return { command: configured, prefix };
  if (platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
      if (!root) continue;
      const command = path.join(root, 'Moonlight Game Streaming', 'Moonlight.exe');
      try { await fs.access(command); return { command, prefix }; } catch { /* Try the next standard installation path. */ }
    }
    return { command: 'Moonlight.exe', prefix };
  }
  for (const directory of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    try { await fs.access(path.join(directory, 'moonlight'), fs.constants.X_OK); return { command: 'moonlight', prefix }; }
    catch { /* Fall back to the Flatpak installed by bootstrap. */ }
  }
  for (const root of ['/var/lib/flatpak/app', path.join(os.homedir(), '.local/share/flatpak/app')]) {
    try {
      await fs.access(path.join(root, 'com.moonlight_stream.Moonlight'));
      return { command: 'flatpak', prefix: ['run', 'com.moonlight_stream.Moonlight', ...prefix] };
    } catch { /* Try the other Flatpak scope. */ }
  }
  return { command: 'moonlight', prefix };
}

module.exports = { moonlightCommand };
