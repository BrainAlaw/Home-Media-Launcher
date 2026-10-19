# CURRENT_STATE_claude (round R03)

Status: IN_PROGRESS            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code  ·  Branch: r03/claude  ·  Last update: 2026-10-19

## Tasks
- [x] 1. `background-apps.js` and `test/background-apps.test.js`
- [x] 2. `config.js` validation for `backgroundApps.max`
- [x] 3. `index.js`: registry wiring, `web-app:home`, `launchTile` rules (resume, background the current one, evict), Gaming `hide`/`show`
- [x] 4. Loading card: `launch-loading.js`, `launch-loading.css`, `test/launch-loading.test.js`, wiring in `app.js`, `index.html`, `preload.js`, `index.js` (`launcher:app-ready`)
- [ ] 3b. Home Theatre background (TvBrowserSession `home`/`close` events, `hide()`/`show()`): waits for codex to merge
- [ ] 5. `npm run check` after merging codex, real-display run: Gaming and Home Theatre, Home, resume, four apps with eviction, loading card
- [ ] 6. Final state, `Status: DONE`

## Done
- Registry with limit (default 3, 1-8), eviction closes the oldest, resume removes from background.
- Home on a Gaming website keeps the app (`web-app:home` IPC from the preload that codex is adding).
- Launch of a background app resumes it (`launcher:app-launched` with `resumed: true`).
- Loading card: waiting curve to 92%, fills and fades out on `launcher:app-ready`; hides on failure and on `launcher:app-closed`.

## Verified
- `npm test`: 569 pass, 0 fail (in this worktree, before codex merged).

## Unverified / not done
- Real display: nothing yet in this round.
- Home Theatre background path (depends on codex).
- Browser hide on Linux (not testable here).

## Files changed
- `src/main/background-apps.js`, `test/background-apps.test.js` — new registry.
- `src/main/config.js` — `backgroundApps` validation.
- `src/main/index.js` — background wiring, `web-app:home`, loading events.
- `src/renderer/launch-loading.js`, `src/renderer/launch-loading.css`, `test/launch-loading.test.js` — new card.
- `src/renderer/app.js`, `src/renderer/index.html`, `src/main/preload.js` — card wiring.

## Requests for the coordinator
- None yet.

## Resume notes
Merge `r03/codex` into this branch when codex is DONE, then add the TV adapter in `openTvWebsite` (task 3b), then run the real-display steps of task 5.
