# CURRENT_STATE_claude (round R09)

Status: PARTIAL            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code (subagent of the coordinator chat)  ·  Branch: r09/claude  ·  Last update: 2026-10-19 12:10

## Tasks
- [x] 1. `src/main/ext/system.js`: download then upload phases, `phase` / `downMbps` / `upMbps`, cancel for both
- [x] 2. `status-widgets.js` + `index.html`: `.qs-info` Ethernet card, `.qs-speed-button`, view from `SpeedCardModel`, fade
- [x] 3. CSS (`status.css`): `.qs-info` grey, `.qs-speed-button` own highlight, no `.qs-row` match
- [ ] 4. `npm run check` green: BLOCKED on copilot's `speed-card-model.js` (see below)

## Done
- Step 0: state file, IN_PROGRESS, commit `e607dbc`
- Item 1: download 10 s then upload, `phase`/`downMbps`/`upMbps`, `doneAt` on done, cancel aborts either phase, commit `fe66847`
- Item 2: `networkCardContent` picks ip / result / fading view, `scheduleCardTick` repaints at hold and fade edges, `resultLine` = "↓ x Mbps · ↑ y Mbps", button `#speed-button.qs-speed-button` (no `tabindex`, not a `.qs-row`), commit `1346fb6`
- Item 3: `.qs-info` background `rgb(255 255 255 / .09)` (MK-PC `.status-card`), no focus/hover rule on card; `.qs-speed-button` overrides the generic `.panel button` box (width, min-height, margin, padding) and has its own `:is(:focus, :focus-visible)` rule, commit `954b0b3`
- `styles.css` and `menu.css` needed no change: the only global rules that touch the button are `.panel button` (overridden) and `button:focus { outline: none }` (the button's own focus rule replaces it)

## Verified
- `node --check src/main/ext/system.js`, `node --check src/renderer/status-widgets.js`: OK
- `npm run check`: 672 pass, 2 fail. Both failures are the same cause: `src/renderer/speed-card-model.js` is referenced by `index.html` but does not exist on this branch (`renderer-globals` duplicate-names test and the index.html file-exists test). `test/network-probe.test.js` still passes.

## Unverified / not done
- The card look, the button highlight, the 10 + 10 s run and the 20 s hold are NOT checked on the real screen (no Electron run in this round, as instructed).
- Not run: the 600 ms fade timing, the upload phase and the `doneAt` hold end-to-end.
- Branch `r09/codex` and `r09/copilot` had no commits when this round was written. `runUploadTest`, `UPLOAD_DURATION_MS`, `SpeedCardModel` and `speed-card-model.js` do NOT exist on this branch. The code is written against those names; nothing was faked.

## Files changed
- `src/main/ext/system.js`: `runSpeedCycle` (download, then upload), `startSpeedTest` publishes phase and `doneAt`; imports `runUploadTest`, `SPEED_DURATION_MS`, `UPLOAD_DURATION_MS`
- `src/renderer/status-widgets.js`: `resultLine` (exported), `networkCardContent`, `scheduleCardTick`, `paintNetwork` uses the card view; speed button handler on `#speed-button`
- `src/renderer/index.html`: `#network-card` markup as `.qs-info` with `#speed-button.qs-speed-button`; `<script src="speed-card-model.js">` before `status-widgets.js`
- `src/renderer/status.css`: `.qs-info` grey card, `.qs-speed-button` own highlight, replaces `.net-action`

## Requests for the coordinator
- Assumed API of copilot's `speed-card-model.js` (adjust in the merge if different): `SpeedCardModel.cardView(speed, now)` returns `'ip' | 'result' | 'fading'`; `SpeedCardModel.fadeOpacity(speed, now)` returns 0..1; `SpeedCardModel.RESULT_HOLD_MS` and `SpeedCardModel.FADE_MS` are numbers; `cardView` reads `speed.state`, `speed.doneAt` (epoch ms, set by `system.js` when the cycle is done).
- Assumed API of codex's `backend/net-probe.js`: `runSpeedTest({ signal, onProgress })` returns `{ state: 'done', averageMbps }` after 10 s (`SPEED_DURATION_MS = 10_000`); `runUploadTest({ durationMs, signal, onProgress })` returns `{ state, averageMbps }`; `UPLOAD_DURATION_MS` exported. The default for `runUploadTest` must be 10 s.
- Focus gap in `src/renderer/navigation-menu.js`: `focusin` calls `focusPanel(event.target.closest('.menu-action'))`. For the speed button `closest` returns null, so the focus lens stays on the previous row (`data-focused="true"`). Fix in the coordinator (or a follow-up round): clear `data-focused` and the lens when focus lands on a non-`.menu-action` control in the panel. Also `register()` is called only for `.menu-action`, so gamepad and spatial navigation may not reach `.qs-speed-button`; confirm on the real screen.
- `test/network-probe.test.js` line 54 still tests the old `networkLine` `done` branch (`↓ 480 Mbps · ping 12 ms`). The card no longer calls it for `done`; the branch is dead. Remove it and the test line together in a follow-up. Left unchanged because `test/` is not in my ownership.
- Merge order reminder: codex and copilot first, then this branch. Until then `npm run check` fails on the missing `speed-card-model.js` only.

## Resume notes
- Coordinator: after merging r09/codex and r09/copilot, run `npm run check`. If it is green, the round's item 4 is done and this file can go to DONE after the real-display check.
- If the copilot API differs, change only `networkCardContent` and `scheduleCardTick` in `status-widgets.js`.
- Real display (user): card looks like MK-PC, the highlight appears only on the button, a test runs 10 + 10 s, the result holds 20 s, then fades back to the IP and ping line.
