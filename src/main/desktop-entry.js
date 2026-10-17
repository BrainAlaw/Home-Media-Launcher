'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function parseDesktopEntry(text) {
  const values = {};
  let inDesktopEntry = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inDesktopEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inDesktopEntry || !line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator > 0) {
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      // Exec carries two escape layers; this resolves the string layer (\\ -> \), the tokenizer handles the quoting layer.
      values[key] = key === 'Exec' ? value.replace(/\\\\/g, '\\') : value;
    }
  }
  return values;
}

/** Splits a desktop Exec value into argv; field codes (%f, %u, ...) expand to nothing and %% is a literal percent. */
function tokenizeExec(command) {
  const tokens = [];
  let token = '';
  let started = false;
  let quote = null;
  let stripped = false;
  const flush = () => {
    // A token that only held field codes (for example "%F") disappears entirely.
    if (started && !(token === '' && stripped)) tokens.push(token);
    token = '';
    started = false;
    stripped = false;
  };
  const characters = [...command];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '\\' && index + 1 < characters.length) { token += characters[index + 1]; started = true; index += 1; continue; }
    if (character === '%' && index + 1 < characters.length) {
      index += 1;
      if (characters[index] === '%') { token += '%'; started = true; } else stripped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; started = true; continue; }
    if (/\s/.test(character)) flush();
    else { token += character; started = true; }
  }
  flush();
  return tokens;
}

function entryToTile(entry, source, includeHidden = false) {
  if (entry.Type !== 'Application' || !entry.Name || !entry.Exec) return null;
  if (!includeHidden && (entry.NoDisplay === 'true' || entry.Hidden === 'true')) return null;
  if (entry.TryExec && path.isAbsolute(entry.TryExec)) {
    // Existence is verified during scanning; PATH-based TryExec is left to the process launcher.
  }
  const parts = tokenizeExec(entry.Exec);
  if (!parts.length) return null;
  return {
    id: `desktop:${path.basename(source, '.desktop')}`,
    name: entry.Name,
    icon: entry.Icon || '',
    command: parts[0],
    args: parts.slice(1),
    source
  };
}

async function scanDesktopEntries(options = {}) {
  const directories = options.directories || [
    '/usr/share/applications',
    path.join(os.homedir(), '.local/share/applications')
  ];
  const files = [];
  for (const directory of directories) {
    try {
      for (const name of await fs.readdir(directory)) if (name.endsWith('.desktop')) files.push(path.join(directory, name));
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
    }
  }
  const tiles = await Promise.all(files.map(async (file) => {
    try { return entryToTile(parseDesktopEntry(await fs.readFile(file, 'utf8')), file, options.includeHidden); }
    catch { return null; }
  }));
  const unique = new Map();
  for (const tile of tiles.filter(Boolean)) if (!unique.has(tile.id)) unique.set(tile.id, tile);
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { entryToTile, parseDesktopEntry, scanDesktopEntries, tokenizeExec };
