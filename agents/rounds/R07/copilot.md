# R07 · copilot · Tier S

- Worktree: `.worktrees/r07-copilot` (branch `r07/copilot`). Work only here.
- Read first (exactly these): `AGENTS.md`, `backend/soloist/settings.js`, `src/main/admin/object-fields.js`.
- State file: `agents/state/CURRENT_STATE_copilot.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R07)` in the header, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `backend/soloist/settings.js` (exports only), `src/main/admin/object-fields.js`, `test/admin-object-fields.test.js`, your state file. Nothing else.

## Goal

The field model copies two limits from the soloist validator. Export the limits from the validator and import them, so there is one source.

## Task items

1. In `backend/soloist/settings.js`, export `DEVICE_NAME_MAX` and `BINARY_PATH_MAX` in the module's existing `module.exports`. Do not change their values or the validation code.
2. In `src/main/admin/object-fields.js`, delete the local copies of those two constants and `require('../../../backend/soloist/settings')` to get them. Keep the
   field specs and their `maxLength` values as they are, now coming from the import. Check that the import path is correct from that file's folder.
3. In `test/admin-object-fields.test.js`, add one case: the `soloist` `deviceName` `maxLength` equals `DEVICE_NAME_MAX` imported from `backend/soloist/settings.js`.
4. Run `node --test test/admin-object-fields.test.js` and `npm test` (both must pass). Commit after each item with an English message ending with
   `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item and commit the state file.
5. Set `Status: DONE`, fill every section, commit. If something blocks you, write it under "Requests for the coordinator" and set `Status: BLOCKED`.

## Stop rules

- Do not run Electron. Do not merge, do not push, do not touch `main`.
