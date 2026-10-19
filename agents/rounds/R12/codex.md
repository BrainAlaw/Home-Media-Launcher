# R12 · codex · Tier M (larger)

- Worktree: `.worktrees/r12-codex` (branch `r12/codex`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R12/PLAN.md`, then the files of each task below.
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R12)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.

## Task 1: caret in the on-screen keyboard

Read: `src/renderer/keyboard-layout.js` (the text state: today it only appends and removes at the end), `src/renderer/on-screen-keyboard.js`.

1. In `keyboard-layout.js`, add a caret index to the text state. Insert and backspace act at the caret, the caret moves with them. Keep the existing function names and their return shape for all current callers; add the caret as an extra field. Commit.
2. In `on-screen-keyboard.js`, a mouse click on the text field sets the caret to the clicked character position (use the text layout the field already draws, or the nearest index). The physical keyboard path stays unchanged; left and right arrows move the caret too. Commit.
3. Create `test/keyboard-caret.test.js`: insert at the start, the middle and the end; backspace in the middle; a click position past the end clamps to the end. Commit.

## Task 2: flaky test

Read: `test/controller-pairing.test.js` (find the test `cancel and timeout disable dongle pairing mode`) and the module it calls.

1. Run that test file alone and the full suite a few times. Find what makes the test fail sometimes: shared state between tests, a real timer, a file left by another test, order dependence. Write the cause in the state file. Commit.
2. Fix the cause in the code under test, not by adding a sleep or a retry. If the fix is in the test only because the test is wrong, say so and why. Commit.
3. Run the full suite three times in a row; all must pass. Record the result in the state file.

## Finish

- `npm run check` must pass after each item. Commit the state file with `Status: DONE`, or `PARTIAL` with the item that is not finished.
- Under "Unverified" write: the caret is not checked on the real display.

## Rules

- Do not run Electron. Do not merge, push or touch `main`. Do not touch files outside the two tasks.
