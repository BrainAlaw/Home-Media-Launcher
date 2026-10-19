# R06 · copilot · Tier S

- Worktree: `D:\Github Repos\hml-r06-copilot` (branch `r06/copilot`). Work only here.
- Read first (exactly these, nothing else): `AGENTS.md`, `backend/soloist/settings.js`, `src/main/background-apps.js`.
  For `remote`, `vpn` and `homeHeader` also read lines 74-135 of `src/main/config.js` (the validators, binary-safe: use `grep -a` or `sed -n`).
- State file: `agents/state/CURRENT_STATE_copilot.md`. Copy `agents/STATE_TEMPLATE.md`, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `src/main/admin/object-fields.js` (new), `test/admin-object-fields.test.js` (new), your state file. Nothing else.

## Goal

A pure CommonJS module that describes the editable fields of six structured settings, so the admin panel can build forms from it.
No DOM, no I/O.

## Task items

1. Create `src/main/admin/object-fields.js` (`'use strict'`) exporting `OBJECT_FIELDS`. It is an object keyed by setting name, each value an
   array of field specs `{ key, label, type, help, options?, min?, max?, maxLength? }`. `type` is one of `boolean`, `text`, `enum`,
   `number`, `list` (array of strings). Use the exact keys the validator checks. Fields:
   - `soloist`: `enabled` (boolean), `deviceName` (text, `maxLength` = `DEVICE_NAME_MAX` from `backend/soloist/settings.js`), `binaryPath` (text).
   - `backgroundApps`: `max` (number, `min` = `MIN_MAX`, `max` = `MAX_MAX` from `src/main/background-apps.js`).
   - `homeHeader`: `layout` (enum `split`, `centred`), `showSeconds`, `oledProtection`, `fadeIn` (boolean).
   - `remote`: `enabled`, `allowSelfSigned` (boolean), `host`, `apiUrl`, `moonlightPath` (text), `moonlightArgs`, `streamArgs` (list).
   - `vpn`: `surfsharkProfile`, `surfsharkWireguardProfile` (text), `surfsharkMode` (enum: `auto`, `wireguard-service`, `openvpn-gui`, `rasdial`, `nmcli`).
   - `wallpaper`: `shuffle`, `online` (boolean), `source` (enum: `bundled`, `folder`, `online`, `mixed`).
   Verify each key against its validator. If a key is not validated there, leave it out and write it under "Requests for the coordinator".
   Labels and help texts in English, short, sentence case.
2. In the same file export `validateFieldValue(spec, value)` returning `null` when valid, otherwise a short English message that names the key.
   Rules: boolean → `typeof value === 'boolean'`; text → string, at most `maxLength` when set, no control characters (`/[\x00-\x1f]/`);
   enum → `options.includes(value)`; number → `Number.isInteger` and within `min`/`max`; list → array of strings without `\0`.
   An unknown `spec.type` throws `TypeError`.
3. Create `test/admin-object-fields.test.js` with `node:test` and `node:assert/strict`. Cover: every object in the list has fields; keys are unique per
   object; each validator rule accepts a valid value and refuses an invalid one (boolean with a string, text over `maxLength`, enum outside
   the list, number at `min - 1` and `max + 1`, list with a non-string item, text with a newline).
4. Run `node --test test/admin-object-fields.test.js` (must pass), then `npm test` (must pass). Commit after each item with an English message
   ending with the attribution line `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item in your state file and commit it.
5. Set `Status: DONE` in your state file, fill every section, commit. In "Requests for the coordinator" list the exported names and any key you left out.

## Stop rules

- Stop (`Status: BLOCKED`) if the work grows past about 150 changed lines or a validator is not in the files named above.
- Do not run Electron. Do not merge, do not push, do not touch `main`.
