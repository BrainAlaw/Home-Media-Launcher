# CURRENT_STATE_opencode (round R01)

Status: DONE            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: opencode  ·  Tool: OpenCode  ·  Branch: r01/opencode  ·  Last update: 2026-10-18

## Tasks
- [x] 1. Remove `createHeroBinding` from `src/renderer/launch-session.js` (function, section comment, export entry) and its two tests plus the import entry in `test/launch-session.test.js`; run `npm test`.
- [x] 2. Remove the two dead `motionScheduler` lines from `src/renderer/app.js` (confirm no other use of `motionScheduler` in `src/` first); run `npm run check`.
- [x] 3. Finish this state file: `Status: DONE`, number of lines removed.

## Done
- Task 1 (remove `createHeroBinding` + 2 tests + dead typedefs `GridCoordinate`/`GridRow` + unused `rows` fixture) — commit `8eebb05`
- Task 2 (remove unused `motionScheduler` instance + its change listener from `app.js`; `reducedMotionQuery` kept, still used by `launchTransition` on the next line) — commit `806915e`

## Verified
- `npm test` after task 1: 550 pass, 0 fail (was 552; the two removed tests were the hero ones).
- `npm run check` after task 2: syntax checks + 550 tests, 0 fail.
- Grep of `src/` for `motionScheduler`: only the two deleted lines used it; the `CompositorScheduler` class stays — `navigation-menu.js` still uses it, so `menu-motion.js` is untouched.
- Grep of `src/` for `createHeroBinding` / hero references: none remain in `launch-session.js` or elsewhere.

## Unverified / not done
- No visual/runtime run (Tier S, Electron not launched). Behaviour must be unchanged: both removed sites were provably unused (`createHeroBinding` had no callers in `src/`; `motionScheduler` had no reads after construction).

## Files changed
- `src/renderer/launch-session.js` — removed `createHeroBinding`, its section comment, the export entry and the `GridCoordinate`/`GridRow` typedefs used only by it (49 lines).
- `test/launch-session.test.js` — removed the two hero tests, the `rows` fixture and `createHeroBinding` from the import (24 lines).
- `src/renderer/app.js` — removed the two dead `motionScheduler` lines (2 lines).
- `agents/state/CURRENT_STATE_opencode.md` — this state file.

## Requests for the coordinator
- None.

## Resume notes
n/a (DONE)
