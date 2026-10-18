# CURRENT_STATE_codex (round R02)

Status: PARTIAL
Agent: codex · Tool: Codex · Branch: r02/codex · Last update: 2026-10-18 12:00

## Tasks
- [x] 1. Add JSON mapping, main-process loader/validator/encoder, and tests — `npm test` passed (546/546).
- [x] 2. Implement preload gamepad/remote input and long-press exit — `node --check src/main/web-preload.js` passed.
- [x] 3. Pass keymap argument from openWebsite — `npm run check` passed (546/546).
- [x] 4. Document remote controls and limitations; added the `Back` key alias — `npm run check` passed.
- [x] 5. Final verification and state update — `npm run check` and `git diff --check` passed.

## Done
- Added and validated the JSON keymap, base64 encoder, argument decoder (null fallback), and unit tests.
- Added preload gamepad/remote mapping, autostart argument injection, and UK English documentation.
- Commits: `3dbaf28`, `a8b17c3`, `94a8180`, `bb83007`.

## Verified
- `npm test` passed: 546 tests, 0 failed.
- `npm run check` passed after the main-process argument change: 546 tests, 0 failed.

## Unverified / not done
- `npm run check` passed after the final changes: 546 tests, 0 failed.
- `git diff --check` passed; worktree is clean.

## Files changed
- `backend/remote-keymap.json` — shared button/key mapping and timing.
- `src/main/remote-keymap.js` — mapping validation, load, encode, decode, and argument builder.
- `test/remote-keymap.test.js` — validation, round trip, and fallback coverage.
- `src/main/web-preload.js` — pad and remote dispatch plus Home hold exit.
- `src/main/index.js` — keymap argument added to website preload arguments.
- `backend/REMOTE-APPS.md` — supported controls, limits, mapping edits, and exit gestures.
- `agents/state/CURRENT_STATE_codex.md` — task tracking and handoff.

## Requests for the coordinator
- `src/main/index.js` currently closes on BrowserBack in its existing `before-input-event` handler. That conflicts with mapping BrowserBack to Escape; only the specified openWebsite line was authorised, so coordinator should decide whether to adjust that handler.

## Resume notes
Coordinator: allow a targeted change to the existing BrowserBack `before-input-event` handler (or accept immediate close as a documented exception), then verify the behavior on the real display with a remote/gamepad. The requested BrowserBack-to-Escape behavior is not currently reachable because the main process closes the window before preload handling.
