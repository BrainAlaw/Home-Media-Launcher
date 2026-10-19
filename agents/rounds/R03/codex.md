# R03 · codex · Tier M

- Worktree: `D:\Github Repos\hml-r03-codex` (branch `r03/codex`). Work only here.
- Read first: `AGENTS.md`, `PLAN.md` in this folder (the contract section), `backend/remote-keymap.json`, `src/main/remote-keymap.js`, `src/main/web-preload.js` (whole file), `backend/tv-controls.js` (whole file, it is a string constant), `src/main/tv-browser.js` (class `TvBrowserSession`, around `start`).
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md` first, set `Status: IN_PROGRESS`, commit before writing code.
- Owned files: the list in `PLAN.md`. Do not edit `src/main/index.js` (the coordinator does it). Do not read or print `.env`. Do not run `npm install`.

## Goal

1. **Keymap** (`backend/remote-keymap.json`, loader in `src/main/remote-keymap.js`):
   - `keys`: `Home` and `BrowserHome` -> `home`; `BrowserBack` and `GoBack` -> `back`.
   - `longKeys`: `BrowserBack` and `GoBack` held for `longPressMs` (700 ms) -> `close`.
   - `exitButtons` stays `[16]` and maps to `close` (held).
   - Remove the old `exit` action everywhere. Allowed actions: `up down left right confirm back close home`.
   - Update the validator and `test/remote-keymap.test.js` accordingly.

2. **Gaming websites** (`src/main/web-preload.js`, Electron window):
   - Short `home` (keyDown then keyUp, or a Home press of any length): send `ipcRenderer.send('web-app:home')`. Main will return to the launcher and keep the app running. Do not close.
   - Long Back (700 ms held): call the same close function the hold-to-exit gesture uses. Do not write a second close path.
   - Short Back: history back via `history.back()` in the page; if there is no history, do nothing. Never close on a short Back.
   - Keep the existing gestures (Escape held, B held, Select + Start) with their timing.
   - Pad: Guide held closes (unchanged). D-pad, A and B keep their current behaviour.

3. **Home Theatre websites** (`backend/tv-controls.js` + `src/main/tv-browser.js`, external browser):
   - `TV_CONTROL_SCRIPT` is currently a fixed string. Make it a function `buildTvControlScript(keymap)` that returns the same script with the keymap values inlined as JSON. Keep `TV_CONTROL_SCRIPT` exported as `buildTvControlScript(defaultKeymap)` so existing callers and tests still work.
   - Home key (keydown) reports `home` through the binding `window.hmlHome()`. Back short: `history.back()`. Back long (700 ms): `window.hmlClose()` (use the existing close path in the script, it already handles held Back; keep it, but bind it to the 700 ms from the keymap).
   - In `TvBrowserSession`: before `Page.addScriptToEvaluateOnNewDocument`, call `Runtime.addBinding` with name `hmlHome` and `hmlClose`, listen for `Runtime.bindingCalled` and emit `home` or `close` on the session (EventEmitter). Use the same DevTools connection the class already has.
   - Add `hide()` and `show()` to `TvBrowserSession`. They use the browser target (`Target.getTargets`, `Browser.getWindowForTarget`, then `Browser.setWindowBounds` with `{ windowState: 'minimized' }` for hide and `{ windowState: 'fullscreen' }` for show). Resolve when the command returns. If the browser is gone, reject with a clear error.
   - Tests: the script builder inlines the keymap (test that the string contains the configured timing and key names and does not contain an unreplaced placeholder); `hide`/`show` send the expected DevTools commands (use the existing fake connection pattern if the file has one; otherwise add a minimal fake and test the command payloads).

## Tasks (commit after each, tick it in your state file)

1. Keymap JSON, loader validation, and the new action set. `npm test` passes.
2. `web-preload.js`: `home`, long Back close, short Back history. `node --check` passes.
3. `buildTvControlScript(keymap)` in `tv-controls.js`; tests.
4. `TvBrowserSession`: binding, `home` and `close` events, `hide()` and `show()`; tests for the payloads.
5. `backend/REMOTE-APPS.md`: update the behaviour table (Home returns and keeps the app, long Back closes, short Back history) and the known limits (no hide on Linux verified yet; say so).
6. `npm run check`, commit, `Status: DONE` in your state file, list changed files and open questions for the coordinator.

Do not merge, do not push, do not touch `main`.
