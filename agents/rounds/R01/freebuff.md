# R01 · freebuff · Tier S

- Worktree: `D:\Github Repos\hml-freebuff` (branch `r01/freebuff`). Work only here.
- State file: `agents/state/CURRENT_STATE_freebuff.md` (copy `agents/STATE_TEMPLATE.md`, create it **before** writing code, commit it).
- Owned files: `scripts/doctor.cjs` (new), `test/doctor.test.js` (new), `package.json` (add exactly one line in `"scripts"`), your state file.
- **Never open, print or copy the real `.env` file.** Your script reads it at runtime; you only test with strings.

## Goal

`npm run doctor` prints which configuration keys are set and which helper programs are installed, so the user can see what is missing. It prints key **names** and `set` / `missing` only, never values.

## Facts you need (do not search for them)

- `const { parseEnv } = require('../backend/env');` — `parseEnv(text)` returns an object of `KEY: value` from `.env` text (comments and quotes handled).
- `const { resolveBinary } = require('../backend/binary-resolver');` — `await resolveBinary(command, { platform, env })` resolves to a path string when the program is found and to a falsy value otherwise.
- Keys to report: `VP_API`, `VP_HOST`, `VP_IP`, `WEATHER_API`, `STEAMDB_API`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_SOLOIST_API`.
- Programs to report: `moonlight`, `tailscale`, `soloist` (Linux only; on other platforms print `not supported on this OS`), `nmcli` (Linux only).
- `.env` path: `path.join(__dirname, '..', '.env')`. If the file does not exist, every key is `missing`.

## Code shape (fill in, keep it small)

```js
'use strict';
// Exports pure helpers for tests; runs the report when executed directly.
function checkEnvKeys(text, keys) { /* -> [{ key, present: boolean }] ; empty value counts as missing */ }
async function checkPrograms(names, { resolve, platform }) { /* -> [{ name, found: boolean, note? }] */ }
function formatReport(envRows, programRows) { /* -> string, one line per row, never any value */ }
module.exports = { checkEnvKeys, checkPrograms, formatReport };
if (require.main === module) { /* read .env if present, run checks, print formatReport, exit code 0 */ }
```

## Tasks (commit after each, tick it in your state file)

1. `scripts/doctor.cjs` with the three helpers and the direct-run block.
2. `test/doctor.test.js` (`node:test`): `checkEnvKeys` on a sample string (set, empty, missing keys); `checkPrograms` with a fake `resolve`; `formatReport` output never contains a value from the sample (for example assert the string `secret123` is absent).
3. In `package.json` add `"doctor": "node scripts/doctor.cjs",` inside `"scripts"` (do not change anything else). Run `npm test`, then `npm run doctor` once and note in the state file that it ran (do not paste its output). Finish with `Status: DONE`.
