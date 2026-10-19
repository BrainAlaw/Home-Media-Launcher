# R07 · cursor · Tier S

- Worktree: `.worktrees/r07-cursor` (branch `r07/cursor`). Work only here.
- Read first (exactly these): `AGENTS.md`, `src/main/admin/panel/panel.css`.
- State file: `agents/state/CURRENT_STATE_cursor.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R07)` in the header, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `src/main/admin/panel/panel.css`, your state file. Nothing else. Claude builds the HTML and JavaScript with the class names below, in parallel with you.

## Goal

Add styles for the panel pages claude is writing now (status, log, actions, object editors). The class names are a contract: use exactly these names, and do not rename or remove any existing class.

## Class contract (add these, all under `.panel`)

- Status: `.status-grid` (grid, one column on a phone, two or more on wider screens), `.status-item`, `.status-item-label`, `.status-item-value`,
  and state modifiers `.status-state-ok`, `.status-state-unknown`, `.status-state-error` (use colour and a text label, not colour alone).
- Log: `.log-view` (a `pre`: monospace, wraps long lines, max height with its own scroll, no horizontal page scroll), `.log-line`.
- Actions: `.action-list`, `.action-button` (min height 44 px for touch), `.action-button-destructive` (a warning colour), `.action-result`,
  and `.action-result-ok`, `.action-result-error`.
- Object editors: `.object-editor` (a form block), `.object-editor-field`, `.object-editor-field-error`, `.object-editor-actions`,
  `.object-editor-readonly-hint` (for the read-only blocks, muted text).
- Diagnostics: `.diagnostics-link` (looks like a button, same size as `.action-button`).

## Task items

1. Add the status classes above, with the phone layout (16 px side gutter, one column under 640 px, no horizontal scroll).
2. Add the log, action and diagnostics classes above, with `:focus-visible` outlines (2 px, 2 px offset) and `min-height: 44px` on buttons.
3. Add the object-editor and read-only-hint classes above. The error class uses a warning colour and must stay readable in both light and dark (`prefers-color-scheme`).
4. Add `@media (prefers-reduced-motion: reduce)` rules that stop transitions and animations for these classes. Do not use external URLs or fonts.
5. Run `npm test` (must pass; it does not cover CSS). Commit after each item with an English message ending with
   `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item and commit the state file.
6. Set `Status: DONE`, fill every section, commit. In "Unverified" write: "not checked on a real display".

## Stop rules

- Do not run Electron, do not run the app. Do not merge, do not push, do not touch `main`.
- Stop (`Status: BLOCKED`) if a class needed by the contract is already defined with a different meaning in the file.
