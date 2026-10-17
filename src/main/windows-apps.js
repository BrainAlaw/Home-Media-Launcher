'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/** Splits a Windows command line (CommandLineToArgvW rules): backslashes are literal unless they precede a quote. */
function splitWindowsArguments(commandLine) {
  const args = [];
  let token = '';
  let started = false;
  let inQuotes = false;
  const text = String(commandLine);
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      let count = 0;
      while (text[index] === '\\') { count += 1; index += 1; }
      started = true;
      if (text[index] === '"') {
        token += '\\'.repeat(Math.floor(count / 2));
        if (count % 2) token += '"'; else inQuotes = !inQuotes;
      } else { token += '\\'.repeat(count); index -= 1; }
      continue;
    }
    if (character === '"') { inQuotes = !inQuotes; started = true; continue; }
    if (!inQuotes && /\s/.test(character)) {
      if (started) args.push(token);
      token = '';
      started = false;
    } else { token += character; started = true; }
  }
  if (started) args.push(token);
  return args;
}

async function findShortcuts(directory) {
  const results = [];
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'EACCES') return results; throw error; }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await findShortcuts(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) results.push(fullPath);
  }
  return results;
}

async function scanWindowsApplications(readShortcutLink, directories = []) {
  const roots = directories.length ? directories : [
    process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter(Boolean);
  const shortcutPaths = (await Promise.all(roots.map(findShortcuts))).flat();
  const tiles = [];
  for (const shortcutPath of shortcutPaths) {
    try {
      const shortcut = readShortcutLink(shortcutPath);
      if (!shortcut.target || /uninstall/i.test(path.basename(shortcutPath))) continue;
      tiles.push({
        id: `windows:${shortcutPath.toLowerCase()}`,
        name: path.basename(shortcutPath, '.lnk'),
        icon: shortcut.icon && !shortcut.icon.includes(',') ? shortcut.icon : '',
        command: shortcut.target,
        args: splitWindowsArguments(shortcut.args || ''),
        cwd: shortcut.cwd || undefined,
        source: shortcutPath
      });
    } catch { /* Ignore broken shortcuts. */ }
  }
  const unique = new Map();
  for (const tile of tiles) if (!unique.has(`${tile.name}\0${tile.command}`)) unique.set(`${tile.name}\0${tile.command}`, tile);
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name));
}

module.exports = { findShortcuts, scanWindowsApplications, splitWindowsArguments };
