# R09 · copilot · Tier S

- Worktree: `.worktrees/r09-copilot` (branch `r09/copilot`). Work only here.
- Read first (exactly these): `AGENTS.md`, `agents/rounds/R09/PLAN.md`, `src/renderer/status-widgets.js` (function `networkLine`, the speed text).
- State file: `agents/state/CURRENT_STATE_copilot.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R09)` in the header, `Status: IN_PROGRESS`, commit first.
- Log: append one short line per finished step to `.worktrees/logs/r09-copilot.log`. No file contents in the log.
- Owned files: `src/renderer/speed-card-model.js` (new), `test/speed-card-model.test.js` (new), your state file. Nothing else.

## Goal

A pure view model that decides what the Ethernet card shows: the IP view or the result view, and the fade state. No DOM, no timers.
Time is passed in as numbers.

## Interface (keep exactly)

- `cardView({ speed, finishedAt, now })` returns one of `'ip'`, `'result'`, `'fading'`.
  - `speed` is the speed state object: `{ state, phase, downMbps, upMbps }` (state is `'idle' | 'running' | 'done' | 'error' | 'cancelled'`).
  - While `state === 'running'`, return `'ip'` (the progress is shown by the button, not by this view).
  - When `state === 'done'` and `finishedAt` is a number: return `'result'` while `now - finishedAt < 20000`; return `'fading'` while
    `20000 <= now - finishedAt < 20600`; return `'ip'` after that.
  - `'error'` and `'cancelled'` return `'ip'` at once.
  - If `finishedAt` is not a number while `done`, return `'result'`.
- `fadeOpacity(view, elapsedMs)`: `'fading'` returns a number from 1 down to 0 over 600 ms (linear, clamped 0..1 and based on `elapsedMs` since the fade
  started); `'result'` returns 1; `'ip'` returns 0.
- Constants exported: `RESULT_HOLD_MS = 20000`, `FADE_MS = 600`.

## Task items

1. Create `src/renderer/speed-card-model.js` as an IIFE with the interface above. Expose `window.SpeedCardModel` when `window` exists and
   `module.exports` when `module` exists. Keep it under 80 lines. Commit.
2. Create `test/speed-card-model.test.js` (`node:test`): each branch of `cardView`; the hold boundary (19999 ms result, 20000 fading);
   the fade boundary (20599 fading, 20600 ip); `fadeOpacity` at 0, 300 and 600 ms; the constants. Commit.
3. Run `npm run check` (must pass). Tick items and commit the state file.
4. Set `Status: DONE`, fill every section, commit.

## Stop rules

- Do not run Electron. Do not touch other files. Do not merge, push or touch `main`.
