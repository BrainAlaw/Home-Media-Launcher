# R02 · codex · Tier M

- Worktree: `D:\Github Repos\hml-codex` (branch `r02/codex`). Work only here.
- Read first: `AGENTS.md`, `src/main/web-preload.js` (whole file), `src/main/index.js` function `openWebsite` (about line 224), `src/renderer/gamepad-input.js` (button map and deadzone), `src/renderer/remote-keymap.js` (remote key names and the 500 ms long press).
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md` first, set `Status: IN_PROGRESS`, tick the items below, commit before writing code.
- Owned files: listed in `agents/rounds/R02/PLAN.md`. Do not edit anything else. Only the one line in `openWebsite` described under "Main process" is allowed outside your files.
- Do not read or print `.env`. Do not run `npm install`; `node_modules` is linked from the main checkout.

## Goal

When a website or chromium webapp is open fullscreen from the launcher:
- gamepad D-pad and left stick move in the page as arrow keys, A is Enter, B is Escape (a normal tap, so the page's own Escape handling still works);
- Bluetooth TV remote keys (arrows, Enter, Back, BrowserBack, GoBack) behave the same;
- a long press (700 ms) of Home or BrowserHome on the remote, or the gamepad Guide button (button 16), closes the app and returns to the launcher. Short Home presses are forwarded to the page as nothing (ignored).
- The existing hold-to-exit gestures (Escape held, B held, Select + Start) keep working. Do not change their timing.

## Constraints you must respect

- `web-preload.js` runs with `sandbox: true`. A sandboxed preload cannot `require` local modules and cannot read files. So the pure mapping must not be a separate module inside the preload. Use this design instead:
  1. `backend/remote-keymap.json`: the single source of truth, a JSON object with `buttons` (gamepad index to action), `keys` (KeyboardEvent key or code to action), `axisDeadzone` (0.6), `longPressMs` (700), and `exitButtons` (`[16]`).
  2. `src/main/remote-keymap.js`: `loadRemoteKeymap()` reads and validates the JSON with `fs` (main process) and `encodeRemoteKeymap(map)` returns a base64 string of the JSON.
  3. `openWebsite` passes that string with `webPreferences.additionalArguments: ['--hml-keymap=<base64>']`. The preload reads it from `process.argv` (available in sandboxed preloads), decodes it and uses it. If the argument is missing or invalid, the preload falls back to the built-in exit gestures only, never throws.
  4. `test/remote-keymap.test.js`: validates the JSON (required keys, actions from the fixed set `up down left right confirm back exit`, numbers in range) and round-trips `encodeRemoteKeymap` / decode.

## Main process (one line, nothing else)

In `openWebsite`, add to `webPreferences`: `additionalArguments: [remoteKeymapArgument()]` where `remoteKeymapArgument` comes from `src/main/remote-keymap.js`. Do not change the rest of the window setup.

## Behaviour details

- Pad: poll `navigator.getGamepads()` once per animation frame in the preload (the preload already polls for the hold-to-exit gesture, reuse that loop). Edge-trigger the actions; auto-repeat only the four directions (initial 380 ms, then 90 ms).
- Dispatch: for `up/down/left/right/confirm/back`, dispatch a `keydown` then `keyup` on `document.activeElement || document.body` with `key` `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Enter`/`Escape`, `bubbles: true`, `cancelable: true`. Mark synthetic events so your own listeners ignore them.
- Remote long press: on keydown of a key listed as `exit` in `keys` (Home, BrowserHome), start a timer; on keyup before 700 ms do nothing; after 700 ms trigger the same exit as the Guide button. Ignore OS auto-repeat (`event.repeat`).
- Exit: call the same function the existing hold-to-exit gesture calls (find it in `web-preload.js`); do not write a second exit path.

## Tasks (commit after each, tick it in your state file)

1. `backend/remote-keymap.json`, `src/main/remote-keymap.js` and `test/remote-keymap.test.js` (validation, encoding, the fallback when the argument is missing). Run `npm test`.
2. Preload: parse the argument, pad polling, action dispatch, remote long press. Keep the existing overlay code untouched except where the exit call must be shared. Run `node --check src/main/web-preload.js`.
3. One-line change in `openWebsite` as described. Run `npm run check`.
4. `backend/REMOTE-APPS.md` (UK spelling): what works (pad, remote, long-press Home), what does not (pages that ignore synthetic keys, pointer-only UIs, login forms that need a keyboard), how to change the mapping (edit the JSON, restart), and how the exit gesture works.
5. Commit everything, set `Status: DONE` in your state file, list every changed file and any open question for the coordinator (for example pages that do not react to synthetic keys).

Do not merge, do not push, do not touch `main`.
