# CURRENT_STATE_codex (round R02)

Status: IN_PROGRESS
Agent: codex · Tool: Codex · Branch: r02/codex · Last update: 2026-10-18 12:00

## Tasks
- [x] 1. Add JSON mapping, main-process loader/validator/encoder, and tests — `npm test` passed (546/546).
- [x] 2. Implement preload gamepad/remote input and long-press exit — `node --check src/main/web-preload.js` passed.
- [x] 3. Pass keymap argument from openWebsite — `npm run check` passed (546/546).
- [x] 4. Document remote controls and limitations; added the `Back` key alias — pending final full check.
- [ ] 5. Final verification and state update.

## Done
- Added and validated the JSON keymap, base64 encoder, argument decoder (null fallback), and unit tests.

## Verified
- `npm test` passed: 546 tests, 0 failed.
- `npm run check` passed after the main-process argument change: 546 tests, 0 failed.

## Unverified / not done
- Preload parses the injected mapping, dispatches synthetic keyboard events, repeats pad directions, and routes Home/Guide/legacy gestures through one close handler.
- `openWebsite` appends the encoded keymap argument while preserving the app-name argument.

## Files changed
- agents/state/CURRENT_STATE_codex.md — task tracking.

## Requests for the coordinator
- `src/main/index.js` currently closes on BrowserBack in its existing `before-input-event` handler. That conflicts with mapping BrowserBack to Escape; only the specified openWebsite line was authorised, so coordinator should decide whether to adjust that handler.

## Resume notes
Continue with task 3: add the single `additionalArguments` option in openWebsite.
