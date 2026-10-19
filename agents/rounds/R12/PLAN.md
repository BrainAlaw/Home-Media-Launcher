# Round R12: Codex takes larger medium tasks

Goal: give Codex two real medium tasks at once, which the new tier rule allows (`AGENTS.md` section 3.1).

1. **On-screen keyboard caret**: a click places the text caret, typing and backspace work at the caret. Missing since R11.
2. **Flaky test**: `cancel and timeout disable dongle pairing mode` fails sometimes in the full run. Find the cause and fix it in the code.

Base: `main` (after `2dd11a6`).

## Owners

| Agent | Runs as | Worktree | Branch | Tasks |
|---|---|---|---|---|
| `codex` | Codex CLI (M, larger) | `.worktrees/r12-codex` | `r12/codex` | 1 then 2, one branch, one commit per item |

No other agent works in this round, so there are no shared files.

## Files for codex

- Task 1: `src/renderer/keyboard-layout.js`, `src/renderer/on-screen-keyboard.js`, new test `test/keyboard-caret.test.js`.
- Task 2: `test/controller-pairing.test.js` and the module it exercises (find it from the test), no other files.

## Merge order

1. `codex` (one branch, both tasks, `npm run check` must pass).
2. Coordinator: the user checks the caret on the PC (click places it, typing inserts at it, the physical keyboard unchanged).
