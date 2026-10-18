'use strict';

// Exports pure helpers for tests; runs the report when executed directly.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('../backend/env');
const { resolveBinary } = require('../backend/binary-resolver');

const ENV_KEYS = ['VP_API', 'VP_HOST', 'VP_IP', 'WEATHER_API', 'STEAMDB_API', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_SOLOIST_API'];
const PROGRAMS = ['moonlight', 'tailscale', 'soloist', 'nmcli'];
const LINUX_ONLY = new Set(['soloist', 'nmcli']);

/** Reports which keys have a non-empty value in the given `.env` text. Never exposes values. */
function checkEnvKeys(text, keys) {
  const values = parseEnv(typeof text === 'string' ? text : '');
  return keys.map((key) => {
    const value = values[key];
    return { key, present: typeof value === 'string' && value.trim() !== '' };
  });
}

/** Resolves each program name. Linux-only programs are skipped with a note on other platforms. */
async function checkPrograms(names, { resolve, platform }) {
  const rows = [];
  for (const name of names) {
    if (LINUX_ONLY.has(name) && platform !== 'linux') {
      rows.push({ name, found: false, note: 'not supported on this OS' });
      continue;
    }
    const found = Boolean(await resolve(name));
    rows.push({ name, found });
  }
  return rows;
}

/** One line per row: key/program name plus status only, never a value. */
function formatReport(envRows, programRows) {
  const lines = [];
  for (const row of envRows) lines.push(`${row.key}: ${row.present ? 'set' : 'missing'}`);
  for (const row of programRows) {
    const status = row.found ? 'found' : (row.note || 'not found');
    lines.push(`${row.name}: ${status}`);
  }
  return lines.join('\n');
}

module.exports = { checkEnvKeys, checkPrograms, formatReport };

if (require.main === module) {
  const envPath = path.join(__dirname, '..', '.env');
  let text = '';
  try { text = fs.readFileSync(envPath, 'utf8'); } catch { text = ''; }
  const envRows = checkEnvKeys(text, ENV_KEYS);
  const resolve = (name) => resolveBinary(name, { platform: process.platform, env: process.env });
  checkPrograms(PROGRAMS, { resolve, platform: process.platform })
    .then((programRows) => { console.log(formatReport(envRows, programRows)); })
    .catch((error) => { console.error('doctor failed:', error.message); process.exitCode = 1; });
}
