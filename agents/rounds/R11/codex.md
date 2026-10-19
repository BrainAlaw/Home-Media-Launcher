# R11 · codex · Tier M

- Worktree: `.worktrees/r11-codex` (branch `r11/codex`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R11/PLAN.md` (the shared contract is fixed there), `docs/MOUSE-AUDIT.md` (section b and c for the media card),
  `src/renderer/media-widget.js` (keyboard actions around lines 441-446, the click handler around line 456), `src/renderer/status-widgets.js` (the top
  of the file, for the UMD pattern).
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R11)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.
- Owned files: `src/renderer/mouse-mode-model.js`, `test/mouse-mode-model.test.js`, `src/renderer/media-widget.js`, `test/media-widget-mouse.test.js`,
  your state file. Nothing else.

## Task items

1. Create `src/renderer/mouse-mode-model.js` with `wheelToHorizontal` and `clickAction` from the contract. UMD, wrapped in an IIFE, under 80 lines.
   Test it in `test/mouse-mode-model.test.js` (wheel with only deltaY, only deltaX, both zero; click on a button, on a `.pointer-target` div, on plain text).
   Commit.
2. In `media-widget.js`, a click on the media card runs the same action as Enter on the focused media control (the keyboard dispatch at lines 441-446).
   Keep the keyboard path unchanged. Add the `.pointer-target` class to the clickable media buttons. Test in `test/media-widget-mouse.test.js` with a
   fake element set, where possible. Commit.
3. Run `npm run check` (must pass). Commit the state file with `Status: DONE`.

## Rules

- Do not run Electron. Do not touch other files. Do not merge, push or touch `main`.
