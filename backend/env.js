'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Parses KEY=VALUE lines. Supports `#` comments, optional `export`, and single/double quoted values. */
function parseEnv(text) {
  const values = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}

/** Loads the first `.env` found into `process.env` without overriding variables that are already set. */
function loadEnv({ candidates = [path.join(__dirname, '..', '.env'), path.join(process.cwd(), '.env')], env = process.env } = {}) {
  for (const file of candidates) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const [key, value] of Object.entries(parseEnv(text))) if (value !== '' && env[key] === undefined) env[key] = value;
    return file;
  }
  return null;
}

/** Typed view of the secrets and hosts the launcher understands. Values never leave the main process. */
function readSecrets(env = process.env) {
  const text = (key) => (typeof env[key] === 'string' ? env[key].trim() : '');
  return Object.freeze({
    vibepolloApiKey: text('VP_API'),
    vibepolloHost: text('VP_HOST'),
    vibepolloIp: text('VP_IP'),
    weatherApiKey: text('WEATHER_API'),
    steamGridDbKey: text('STEAMDB_API') || text('STEAMGRIDDB_API')
  });
}

module.exports = { parseEnv, loadEnv, readSecrets };
