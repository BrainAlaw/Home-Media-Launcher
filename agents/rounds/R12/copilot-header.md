# R12 · copilot · Task 3b: header fields in the admin panel model (split from codex-header.md)

- Worktree: `.worktrees/r12-copilot` (branch `r12/copilot`, created from `main`). Work only here.
- Read first (at most three files): `AGENTS.md`, `src/main/admin/object-fields.js` (the `homeHeader` entry, the pattern to copy),
  `test/admin-object-fields.test.js` (the existing cases).
- State file: `agents/state/CURRENT_STATE_copilot.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R12)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.
- Owned files: `src/main/admin/object-fields.js`, `test/admin-object-fields.test.js`, your state file. Nothing else.

## Task items

1. In `src/main/admin/object-fields.js`, add a `header` entry in `OBJECT_FIELDS`, the same way `homeHeader` is written, with these fields in this order:
   - `showText` (boolean): "Show header text"
   - `text` (text, `maxLength: 80`): "Header text"
   - `showDate` (boolean): "Show date"
   - `showTime` (boolean): "Show time"
   - `showWeather` (boolean): "Show weather"
   - `weatherLocation` (text, `maxLength: 120`): "Weather location"
   Each field has a short English `help` sentence. Commit.
2. In `test/admin-object-fields.test.js`, add cases: `header` is in `OBJECT_FIELDS`; it has exactly these six keys; the `text` field has `maxLength` 80 and
   `weatherLocation` has 120; `validateFieldValue` refuses an 81-character `text`. Commit.
3. Run `npm run check` (must pass). Commit the state file with `Status: DONE`.

## Rules

- Do not run Electron. Do not merge, push or touch `main`.
