# R01 · copilot · Tier S

- Worktree: `D:\Github Repos\hml-copilot` (branch `r01/copilot`). Work only here.
- State file: `agents/state/CURRENT_STATE_copilot.md` (copy `agents/STATE_TEMPLATE.md`, create it **before** writing code, commit it).
- Owned files: `test/config-roundtrip.test.js` (new), your state file. Do not edit anything else.

## Goal

Add one new test file that checks `validateConfig` accepts every settings key the Settings dialog writes and rejects bad values. Do not change `src/main/config.js`; if a test exposes a real bug, keep the test, mark it with `test.skip` plus a comment, and report it under "Requests for the coordinator".

## Facts you need (do not search for them)

- Import: `const { validateConfig } = require('../src/main/config');`. It throws an `Error` for invalid input and returns normally for valid input.
- Smallest valid config: `{ settings: {}, rows: [] }` (`rows` must be an array).
- Test style: `const test = require('node:test'); const assert = require('node:assert/strict');`, then `assert.doesNotThrow(() => validateConfig(cfg))` and `assert.throws(() => validateConfig(cfg), /message part/)`.
- Rules to cover (each is a key inside `settings`):
  - `categories`: array of 1 to 24 objects `{ id, label, builtin? }`. `id` matches `/^[a-z0-9][a-z0-9-]{0,39}$/`, unique; `label` 1-40 chars; `builtin` only `'theatre'` or `'gaming'` and must equal `id`; the list must contain ids `theatre` and `gaming`. Errors mention "categories" or the offending field.
  - `homeHeader`: optional object; `layout` is `'split'` or `'centred'`; `showSeconds`, `oledProtection`, `fadeIn` are booleans.
  - `showTileLabels`, `mediaWidget`: booleans.
  - `soloist`: optional object; `enabled` boolean; `deviceName` non-empty string up to 64 chars, no control characters; `binaryPath` string, either `''` or an absolute path.
  - `hiddenAppIds`: array of strings.
  - `performance`: `'auto'`, `'quality'` or `'lite'`.
- Website category (top-level `websites`, not inside `settings`): `websites: [{ name: 'YouTube', url: 'https://www.youtube.com', category: 'theatre' }]` is valid; `category` must be a non-empty string up to 64 chars.

## Tasks (commit after each, tick it in your state file)

1. One test: a full valid config using every key above at once passes.
2. Tests: one valid and at least one invalid case per key (categories: missing `gaming`, duplicate id, bad id, label too long; homeHeader: bad layout, non-boolean flag; soloist: relative `binaryPath`, empty `deviceName`; performance: unknown value; website category: empty string).
3. Run `npm test` and make sure everything passes. Finish the state file with `Status: DONE`.
