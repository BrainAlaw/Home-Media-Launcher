# CURRENT_STATE_codex (round R03)

Status: IN_PROGRESS
Agent: codex · Tool: Codex · Branch: r03/codex · Last update: 2026-10-19 12:00

## Tasks
- [x] 1. Update remote keymap actions and validation tests — `npm test` passed (558 passed, 1 skipped).
- [x] 2. Implement Gaming web Home, Back history, and long Back close — `node --check src/main/web-preload.js` passed.
- [x] 3. Build configurable TV control script and tests — targeted test and `npm run check` passed (559 passed, 1 skipped).
- [ ] 4. Add TV browser home/close bindings and hide/show methods with tests.
- [ ] 5. Update remote app documentation.
- [ ] 6. Run full checks and complete handoff state.

## Done
- Updated map schema to `close`/`home`, added `longKeys`, and rejected the removed `exit` action.
- Gaming preload sends Home IPC, navigates history on short Back, and closes through shared `triggerExit` on long Back.
- Added `buildTvControlScript(keymap)` and retained `TV_CONTROL_SCRIPT` as the default generated script; it inlines mappings and the configured hold duration.

## Verified
- Read repository instructions, R03 plan contract, and assigned source/tests.

## Unverified / not done
- Implementation pending.

## Files changed
- agents/state/CURRENT_STATE_codex.md — task tracking.

## Requests for the coordinator
- None.

## Resume notes
Start task 1: update JSON action schema and validator/tests.
