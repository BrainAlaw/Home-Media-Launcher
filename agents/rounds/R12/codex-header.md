# R12 · codex · Task 3: header editor in the admin panel (run after the other two tasks of codex.md)

- Worktree: `.worktrees/r12-codex` (branch `r12/codex`, same branch as tasks 1 and 2). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R12/PLAN.md`, `src/main/config.js` (`validateHomeHeader` and `validateConfig`, the pattern to copy),
  `src/main/admin/object-fields.js` (the `homeHeader` entry, the pattern to copy), `src/renderer/settings.js` (lines around 588-600: the header fields
  the TV settings page already edits, with their defaults).
- State file: `agents/state/CURRENT_STATE_codex.md`. Add a section "Task 3: header editor" and tick the item there.
- No log lines.

## What the object looks like

`settings.header`, fields as the TV settings page reads them:
- `showText` (boolean, default false), `text` (string, default empty), `showDate` (boolean, default true), `showTime` (boolean, default true),
  `showWeather` (boolean, default false), `weatherLocation` (string, default empty).

There is no validator for it yet, so the server accepts anything. The admin panel will save it through `PUT /api/config`.

## Task items

1. In `src/main/config.js`, add `validateHeader(header)` next to `validateHomeHeader`, following its pattern: `undefined` is allowed, a non-object
   throws `header must be an object`, each boolean key must be a boolean, each text key must be a string of at most 80 characters (`text`) or
   120 characters (`weatherLocation`) with no control characters (`/[\x00-\x1f]/`). Call it from `validateConfig`. Commit.
2. Create `test/admin-config-header.test.js` (`node:test`): valid header accepted; a non-boolean `showDate` rejected with the key name in the message;
   text over 80 characters rejected; a control character rejected; `undefined` accepted. Commit.
3. In `src/main/admin/object-fields.js`, add a `header` entry with the six fields, the same way `homeHeader` is written. Labels in English, short.
   The text fields get the same `maxLength` as the validator. Commit.
4. Test in `test/admin-object-fields.test.js` (the existing file, add cases): `header` is in `OBJECT_FIELDS` and its text fields have the lengths above.
   Commit.
5. Run `npm run check` (must pass). Set the task 3 section to `Status: DONE` in the state file and commit.

## Rules

- Do not run Electron. Do not merge, push or touch `main`. Do not touch files outside the list above.
- Under "Unverified" write: the header editor is not checked on the real display or in the browser panel.
