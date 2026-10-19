# CURRENT_STATE_codex (round R03)

Status: DONE
Agent: codex · Tool: Codex · Branch: r03/codex · Last update: 2026-10-19 12:00

## Tasks
- [x] 1. Update remote keymap actions and validation tests — `npm test` passed (558 passed, 1 skipped).
- [x] 2. Implement Gaming web Home, Back history, and long Back close — `node --check src/main/web-preload.js` passed.
- [x] 3. Build configurable TV control script and tests — targeted test and `npm run check` passed (559 passed, 1 skipped).
- [x] 4. Add TV browser home/close bindings and hide/show methods with tests — `npm run check` passed (562 passed, 1 skipped).
- [x] 5. Update remote app documentation — Gaming/Home Theatre controls, limitations, and Linux hide/show verification caveat included.
- [x] 6. Run full checks and complete handoff state — `npm run check` passed (562 passed, 1 skipped).

## Done
- Updated map schema to `close`/`home`, added `longKeys`, and rejected the removed `exit` action.
- Gaming preload sends Home IPC, navigates history on short Back, and closes through shared `triggerExit` on long Back.
- Added `buildTvControlScript(keymap)` and retained `TV_CONTROL_SCRIPT` as the default generated script; it inlines mappings and the configured hold duration.
- TvBrowserSession installs hmlHome/hmlClose bindings, emits corresponding events, and supports hide/show through browser window bounds; fake-connection tests cover payloads and missing-browser errors.
- Updated remote app documentation for Home and Back behaviour and the unverified Linux window-state commands.

## Verified
- `npm run check`: 562 passed, 0 failed, 1 skipped (bash-dependent Linux script test unavailable in this Windows environment).
- `node --check src/main/web-preload.js` passed.
- Focused TV controls tests: 7 passed.
- `git diff --check` passed; worktree clean after this state commit.

## Unverified / not done
- No live controller/remote test or Linux verification of Chromium hide/show was available in this worktree.

## Files changed
- `backend/remote-keymap.json` — R03 actions, long keys, and Guide close mapping.
- `src/main/remote-keymap.js` — validates the R03 action schema.
- `src/main/web-preload.js` — Gaming Home, short Back history, and long Back close.
- `backend/tv-controls.js` — configurable TV control script generated from the keymap.
- `src/main/tv-browser.js` — Home/close bindings and browser hide/show methods.
- `test/remote-keymap.test.js` — updated schema validation coverage.
- `test/tv-controls.test.js` — script generation, binding events, and hide/show command coverage.
- `backend/REMOTE-APPS.md` — updated control behaviour and limitations.
- `agents/state/CURRENT_STATE_codex.md` — task tracking and handoff.

## Requests for the coordinator
- Wire Gaming `web-app:home` IPC and TvBrowserSession `home`/`close` events into the main-process lifecycle in the coordinator-owned `src/main/index.js`. Run real-display checks for both website paths; Linux hide/show remains unverified.

## Resume notes
No remaining changes in this worktree. Coordinator-owned main-process event wiring remains as listed above.
