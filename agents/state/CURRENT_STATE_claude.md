# CURRENT_STATE_claude (round R03)

Status: PARTIAL            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code  ·  Branch: r03/claude  ·  Last update: 2026-10-19

## Tasks
- [x] 1. `background-apps.js` and `test/background-apps.test.js`
- [x] 2. `config.js` validation for `backgroundApps.max`
- [x] 3. `index.js`: registry wiring, `web-app:home`, `launchTile` rules (resume, background the current one, evict), Gaming `hide`/`show`
- [x] 4. Loading card: `launch-loading.js`, `launch-loading.css`, `test/launch-loading.test.js`, wiring in `app.js`, `index.html`, `preload.js`, `index.js` (`launcher:app-ready`)
- [x] 3b. Home Theatre background (TvBrowserSession `home`/`close` events, `hide()`/`show()`) via `tvAdapter`
- [x] 5. Real display (Gaming): Home keeps the app, four apps evict the oldest, resume, loading card (`scripts/e2e/background-check.cjs`, 5 of 5 ok, long-Back step blocked)
- [ ] 5b. Real display, Home Theatre path (needs Edge/Chrome on the Windows machine, not run yet)
- [x] 6. Final state

## Done
- Registry with limit (default 3, 1-8), eviction closes the oldest, resume removes from background.
- Home on a Gaming website keeps the app (`web-app:home` IPC from the preload that codex is adding).
- Launch of a background app resumes it (`launcher:app-launched` with `resumed: true`).
- Loading card: waiting curve to 92%, fills and fades out on `launcher:app-ready`; hides on failure and on `launcher:app-closed`.

## Verified
- `npm test`: 573 pass, 0 fail (after merging codex).
- Real display, Gaming websites (second monitor): Home returns and keeps A, opening B, C, D evicts A, resume of C brings back exactly one window, loading card visible on load (screenshot `bg-2026-10-19T07-52-36-254Z/01-a-loading-card.png`).
- Found and fixed on the way: Back is consumed by the main process (long press now closes there); website windows are revealed after `did-finish-load`; the card sits above the black launch cover (z 9050); the harness must click tiles, not call `launchApp`, or the card never shows.

## Unverified / not done
- Home Theatre path on the real display (browser hide/show, Home binding, card for the browser).
- Long Back on the real remote (the harness cannot inject `BrowserBack`).
- Browser hide on Linux (not testable here).
- Pad steps (needs a real controller).

## Files changed
- `src/main/background-apps.js`, `test/background-apps.test.js` — new registry.
- `src/main/config.js` — `backgroundApps` validation.
- `src/main/index.js` — background wiring, `web-app:home`, loading events.
- `src/renderer/launch-loading.js`, `src/renderer/launch-loading.css`, `test/launch-loading.test.js` — new card.
- `src/renderer/app.js`, `src/renderer/index.html`, `src/main/preload.js` — card wiring.

## Requests for the coordinator
- Verify Home Theatre (Edge/Chrome) on the real display: background, resume and the card.
- Verify long Back with the real remote.
- Backgrounds UI in Settings (`backgroundApps.max`) is config-only for now; a Settings control is a follow-up.

## Resume notes
Merge `r03/codex` into this branch when codex is DONE, then add the TV adapter in `openTvWebsite` (task 3b), then run the real-display steps of task 5.
