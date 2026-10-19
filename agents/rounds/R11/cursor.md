# R11 · cursor · Tier S

- Worktree: `.worktrees/r11-cursor` (branch `r11/cursor`). Work only here.
- Read first (at most three files): `AGENTS.md`, `agents/rounds/R11/PLAN.md` (the contract: the `.pointer-target` class and its hover), `src/renderer/controllers.css`.
- State file: `agents/state/CURRENT_STATE_cursor.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R11)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.
- Owned files: `src/renderer/settings-apps.css`, `src/renderer/appearance.css`, `src/renderer/controllers.css`, your state file. Nothing else.

## Task items

1. In the three CSS files, add `cursor: pointer` to the clickable elements of the settings, appearance and controllers pages (buttons, choice buttons,
   rows that are clickable). Do not add a new hover colour: the shared `.pointer-target:hover` rule in `pointer-target.css` (claude's file) handles hover.
   Commit.
2. Make sure focus outlines are not removed anywhere in these files (no `outline: none` without a `:focus-visible` replacement). Fix any you find.
   Commit.
3. Run `npm test` (must pass; it does not cover CSS). Commit the state file with `Status: DONE`.
4. Under "Unverified", write: "not checked on a real display".

## Rules

- Do not run Electron or the app. Do not touch other files. Do not merge, push or touch `main`.
