# R11 · opencode · Tier S

- Worktree: `.worktrees/r11-opencode` (branch `r11/opencode`). Work only here.
- Read first (at most three files): `AGENTS.md`, `agents/rounds/R11/PLAN.md` (the contract), `src/renderer/settings-appearance.js` (the generated choice buttons).
- State file: `agents/state/CURRENT_STATE_opencode.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R11)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.
- Owned files: `src/renderer/settings.js`, `src/renderer/settings-appearance.js`, `test/settings-mouse.test.js` (new), your state file. Nothing else.

## Task items

1. In `settings-appearance.js`, add `.pointer-target` to every generated choice button (theme, colour, font, layout choices). The existing click handlers
   already work; only the class is added. Commit.
2. In `settings.js`, add `.pointer-target` to the settings choice buttons and rows that already have a click handler. Do not change any handler.
   Commit.
3. Test in `test/settings-mouse.test.js`: a static check that both files contain `.pointer-target` at the places you changed, and that the number of
   `addEventListener('click'` calls in each file did not change. Commit.
4. Run `npm run check` (must pass). Commit the state file with `Status: DONE`.

## Rules

- Do not run Electron. Do not touch other files. Do not merge, push or touch `main`.
