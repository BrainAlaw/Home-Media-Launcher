# R11 · copilot · Tier S

- Worktree: `.worktrees/r11-copilot` (branch `r11/copilot`). Work only here.
- Read first (at most three files): `AGENTS.md`, `agents/rounds/R11/PLAN.md` (the contract), `docs/MOUSE-AUDIT.md` (section a and c, pairing and controllers).
- State file: `agents/state/CURRENT_STATE_copilot.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R11)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.
- Owned files: `src/renderer/pairing-wizard-ui.js`, `src/renderer/controllers-page.js`, `src/renderer/controller-list.js`, `test/controllers-mouse.test.js` (new),
  your state file. Nothing else.

## Task items

1. Add `.pointer-target` to the clickable rows and buttons in the pairing wizard and the controller list. Rows that are not buttons get `role="button"`
   and `tabindex="-1"`. A click on a row runs the same function as Enter on it. The keyboard path is unchanged. Commit.
2. Where the audit says the controller status rows or the pairing body are display-only, make them clickable only if a keyboard action exists for
   the same row; otherwise leave them as they are and write that in the state file. Commit.
3. Test in `test/controllers-mouse.test.js`: a static check that the rows you changed carry `.pointer-target`, and that no keyboard handler was removed
   (the count of keydown handlers in each file is unchanged). Commit.
4. Run `npm run check` (must pass). Commit the state file with `Status: DONE`.

## Rules

- Do not run Electron. Do not touch other files. Do not merge, push or touch `main`.
