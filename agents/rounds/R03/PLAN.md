# Round R03: remote everywhere, background apps, launch loading card

Goal:
1. Home returns to the launcher and keeps the app running in the background. Long Back closes the app from anywhere. Short Back steps back in page history.
2. Up to 3 apps in the background (setting `settings.backgroundApps.max`, default 3). Opening a 4th closes the oldest. Opening an app that is in the background resumes it.
3. Fullscreen loading card (logo, name, smooth progress bar, fade in and out) instead of the hard cut.
4. Same remote behaviour for Gaming websites (Electron window) and Home Theatre websites (external browser through DevTools).

Base: `main`. Linux HTPC is the target; the dev machine is Windows.

## Tasks

| Agent | Tier | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | M | `D:\Github Repos\hml-r03-codex` | `r03/codex` | Input for both web paths, and hide/show support for the Home Theatre browser (see `codex.md`) |
| `claude` | L | `D:\Github Repos\hml-r03-claude` | `r03/claude` | Background app registry and limit, resume, Gaming window hide/show, loading card (see `claude.md`) |

## File ownership

| Agent | Owned files |
|---|---|
| `codex` | `backend/remote-keymap.json`, `src/main/remote-keymap.js`, `src/main/web-preload.js`, `backend/tv-controls.js`, `src/main/tv-browser.js`, `test/remote-keymap.test.js`, `test/tv-controls.test.js` (new), `backend/REMOTE-APPS.md`, `agents/state/CURRENT_STATE_codex.md` |
| `claude` | `src/main/index.js`, `src/main/background-apps.js` (new), `src/main/config.js` (one additive block for `backgroundApps`), `src/renderer/launch-loading.js` and `.css` (new), `src/renderer/launch-transition.js`, `src/renderer/app.js` (launch functions only), `src/renderer/index.html` (one link and one script line), `test/background-apps.test.js` (new), `agents/state/CURRENT_STATE_claude.md` |

Contract between the two (agreed here, do not change without a note in both state files):
- Keymap actions become: `up down left right confirm back close home`. `back` = history back (never closes). `close` = close the app. `home` = return to the launcher, app stays in the background. Long press for `close` is `longPressMs` (700 ms) on the Back key; Guide (button 16) held = `close`.
- Web preload and TV script report `home` by IPC (`web-app:home`) and by a CDP binding (`hmlHome`). Main process handles both.
- TV browser class gains `hide()` and `show()` (both return promises, use `Browser.setWindowBounds` with `windowState` `minimized` / `normal` through the browser target) and emits `home` when the binding fires.

## Merge order

1. `codex` (after its state file says DONE and `npm run check` passes in its worktree)
2. `claude` (rebase or merge `main` first if codex changed `index.js`; codex must not touch `index.js`)
3. Coordinator: real-display check of both paths (Gaming and Home Theatre), background limit with four apps, loading card, then ask the user.

## What the user does

| Tool | Folder | Paste |
|---|---|---|
| Codex | `D:\Github Repos\hml-r03-codex` | `Read AGENTS.md and agents/rounds/R03/codex.md, then follow the prompt.` |
