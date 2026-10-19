# R03 · claude · Tier L

- Worktree: `D:\Github Repos\hml-r03-claude` (branch `r03/claude`).
- Read first: `PLAN.md` (contract section), `src/main/index.js` (`openWebsite`, `openTvWebsite`, `launchTile`, `returnToLauncher`, the `webWindow` and `tvBrowser` globals, `ipcMain.on('web-app:close')`), `src/main/ext/session.js` and `src/main/session-machine.js`, `src/renderer/launch-transition.js`, `src/renderer/app.js` (`activate`, launch functions).
- State file: `agents/state/CURRENT_STATE_claude.md` (copy the template, header `(round R03)`, commit first).
- Owned files: the list in `PLAN.md`. Codex owns the keymap, preloads, `tv-controls.js` and `tv-browser.js`; use its contract (`home`, `close`, `hide()`, `show()`, and the `home`/`close` events of `TvBrowserSession`). Until codex merges, build against the contract and mock it in tests.

## Goal

1. **Background registry** (`src/main/background-apps.js`, pure): keeps the apps that are alive but not on screen, in the order they were put in the background. Max count from `settings.backgroundApps.max` (default 3, validated 1-8 in `config.js`). Adding a 4th drops and closes the oldest. Resuming an app removes it from the background list. Pure functions plus a small class; test with node:test.
2. **Launch rules** in `launchTile`:
   - Starting an app that is in the background resumes it (show the window or `tvBrowser.show()`), no new process.
   - Starting a new app while another is on screen: the current one goes to the background (hide, do not close), then the new one starts.
   - Remove the "Another application is already running" error for these cases. Keep it for a native process that is already running (processManager), which is out of scope here: report it.
3. **Home** (`web-app:home` IPC and `TvBrowserSession` `home` event): hide the app (`webWindow.hide()` / `tvBrowser.hide()`), add it to the background registry, show the launcher with the existing `showLauncher()`. Session phase goes back to idle; the app is not closed.
4. **Close** (`web-app:close` IPC from long Back or Guide, and `TvBrowserSession` `close` event): close the app and remove it from the registry. Existing `returnToLauncher` path.
5. **Loading card** (`src/renderer/launch-loading.js`, `.css`, new): a full-screen card in the launcher, shown when a launch starts instead of the black cover: tile logo (the tile icon when it is an image, otherwise the monogram from `tile-art` / the same colour rules the tiles use), name below, a smooth progress bar that fills over about 2.5 s and completes when the main process reports the app window ready (`launcher:app-ready` event you add, sent on `ready-to-show` for Electron and after `Page.loadEventFired` or `show()` for the browser). Fade in at start, fade out when the app window is visible. Transform and opacity only. Reduced motion: instant.
6. Settings: `backgroundApps.max` in `config.js` (validate integer 1-8, default 3) and nothing in the UI yet (report the UI as a follow-up).

## Tasks (commit after each, tick it in your state file)

1. `background-apps.js` and `test/background-apps.test.js` (order, limit eviction returns the evicted apps, resume removes, unknown ids are ignored).
2. `config.js` validation for `backgroundApps.max`; test in `test/background-apps.test.js` or the existing config test.
3. `index.js`: registry wiring, `web-app:home`, `launchTile` rules (resume, background the current one, evict), `hide`/`show` for `webWindow` and `tvBrowser`. Keep `openWebsite` and `openTvWebsite` signatures.
4. Loading card: `launch-loading.js`, `launch-loading.css`, the hook in `launch-transition.js` (replace the black cover with the card during launch) and the one-line link/script in `index.html`. Test the pure progress and phase logic.
5. `npm run check`, then the real display: start a Gaming website, press Home, start a second website, Home, start a third and a fourth (oldest evicted), resume the first from its tile. Capture each step with `desktopCapturer` on the second monitor (`HML_E2E_DISPLAY` logic in `scripts/e2e/gamepad-e2e.cjs`) and read the screenshots. Home Theatre paths: say what you could not verify (Linux browser hide).
6. State file: `Status: DONE` (or `PARTIAL`), list changed files, real-display results, and what is not verified.

Do not merge, do not push, do not touch `main`.
