# R12 · opencode · Task 3a: validator for the header object (split from codex-header.md)

- Worktree: `.worktrees/r12-opencode` (branch `r12/opencode`, created from `main`). Work only here.
- Read first (at most three files): `AGENTS.md`, `src/main/config.js` (the function `validateHomeHeader` and its call in `validateConfig`, the pattern
  to copy), `agents/rounds/R12/codex-header.md` (the field list and the limits).
- State file: `agents/state/CURRENT_STATE_opencode.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R12)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.
- Owned files: `src/main/config.js` (only the new function and its call), `test/admin-config-header.test.js` (new), your state file. Nothing else.

## Task items

1. In `src/main/config.js`, add `validateHeader(header)` next to `validateHomeHeader`, same pattern: `undefined` is allowed; a non-object throws
   `header must be an object`; each boolean key (`showText`, `showDate`, `showTime`, `showWeather`) must be a boolean, error names the key;
   `text` is a string of at most 80 characters and `weatherLocation` a string of at most 120 characters, neither with control characters
   (`/[\x00-\x1f]/`). Call it from `validateConfig` next to the `validateHomeHeader` call. Commit.
2. Create `test/admin-config-header.test.js` (`node:test`): valid header accepted; `showDate: 'yes'` rejected with `showDate` in the message;
   text of 81 characters rejected and 80 accepted; a control character in `weatherLocation` rejected; `undefined` accepted. Commit.
3. Run `npm run check` (must pass). Commit the state file with `Status: DONE`.

## Rules

- Do not run Electron. Do not merge, push or touch `main`.
