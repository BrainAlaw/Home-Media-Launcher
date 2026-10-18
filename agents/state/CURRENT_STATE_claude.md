# CURRENT_STATE_claude (round R01)

Status: DONE            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code  ·  Branch: r01/claude  ·  Last update: 2026-10-18

## Tasks
- [x] 1. Clean CURRENT_STATE.md
- [x] 2. Gamepad end-to-end harness scripts/e2e/gamepad-e2e.cjs
- [x] 3. Run it, read screenshots, write the R02 bug list
- [x] 4. Finish the state file

## Done
- Clean `CURRENT_STATE.md`: stale entries fixed or removed, test count updated (commit on this branch).
- Harness `scripts/e2e/gamepad-e2e.cjs`: boots the real app fullscreen with a copy of the user's config (`config.json`, `remote-apps.json`, `themes.json`), installs a scripted standard-mapping pad, runs 6 scenarios (home, widget, music view, quick settings, on-screen keyboard in Settings, icon popup), captures the real display with `desktopCapturer`, records renderer console errors, writes `scripts/e2e/out/<run>/report.md` and `report.json`. Output is git-ignored.
- Last run: 24 steps, 2 failed (the second one is a diagnostic, see bug 1). Console errors: 0.

## Verified
- Final run against the real `.env` (main checkout, `HML_E2E_ROOT`): 24 steps, 1 failed (bug 1, reproduced). Music view shows "Sign in to Spotify" (client id set, account not signed in), consistent with the real state.
- Earlier run on the dev machine, fullscreen. Read `01-home.png`, `03-music-view.png` (shows the honest "Spotify is not set up" state, see note 2).
- The harness bugs found while running it were fixed in the harness itself: the first attempt opened the network card (started a speed test) because the sheet's first row is Settings; the widget step expected rows after one Down, but from the header Down lands on the widget first.

## Unverified
- Visual checks of `02-widget`, `04-quick-settings`, `05-osk`, `06-icon-popup` beyond the step assertions.

## Files changed
- `CURRENT_STATE.md` — stale entries cleaned.
- `scripts/e2e/gamepad-e2e.cjs` — new harness.
- `.gitignore` — `scripts/e2e/out/`.
- `agents/state/CURRENT_STATE_claude.md` — this file.

## Bugs for R02 (input for the next round)

1. **[M] Settings dialog: the first B after closing the icon popup is ignored.** Reproduced: from the icon thumbnail, B closes the popup, the next B does nothing, the second B closes Settings. Likely cause: the Back swallow window in `src/renderer/icon-popup.js` (`SWALLOW_MS`, 350 ms) starts after the close animation, so it covers about 650 ms of real time and the harness' next press (about 540 ms) lands inside it. Check the timing first; fix may be to start the window at the moment of closing, or to not swallow Back at all when Settings is open.
2. **[S] Boot focus: after start, no tile is focused in about 1 of 3 runs** (focus stays on `body`). The rows get focus after the first input. Likely the initial `setFocus` in `src/renderer/app.js` runs before the rows are rendered; verify on the real display with a cold start.
3. **[S] Missing `.env` in worktrees makes configured services look unconfigured** (workflow trap, not an app bug). Fixed in the harness: `HML_E2E_ROOT=<main repo> npx electron <harness>` runs the app code and `.env` from the main checkout while the harness itself lives in the worktree.
5. **[M] Music view opens without moving focus into it.** After `launcher:open-media-view`, `document.activeElement` is still the home tile behind the view (`button.tile "Netflix"`), so a d-pad press can move the background grid while the view is on top. Fix in `src/renderer/media-view.js` `open()`: focus the view's first control and restore focus on close (the close path already restores the previous element; verify it still does).
4. **[S] Music view empty state uses a plain text screen** for "not set up" (visible in `03-music-view.png`). Acceptable, but the same copy appears in the widget card; consider one shared string.

## Requests for the coordinator
- Bug 1 (Back timing) and bug 5 (music view focus) are both small and in one area each; bug 5 can go to Codex (one module, clear acceptance: focus lands in the view and returns on close). Bug 1 needs the timing check first, so coordinator.
- Before R02 starts, run the harness with `HML_E2E_ROOT` on the main checkout to get a baseline; keep the output folder of that run as the reference.

## Resume notes
Not needed: status is DONE.
