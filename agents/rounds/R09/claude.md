# R09 · claude · Tier L (runs as a subagent of the coordinator chat)

- Worktree: `.worktrees/r09-claude` (branch `r09/claude`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R09/PLAN.md` (the contract is fixed there), `src/main/ext/system.js` (`startSpeedTest`, `publishSpeed`,
  `getSpeedTest`), `src/renderer/status-widgets.js` (the network card, `networkLine`, the speed button handler, `applySpeed`),
  `src/renderer/status.css`, `src/renderer/menu.css`, `src/renderer/styles.css`, `src/renderer/index.html`.
- State file: `agents/state/CURRENT_STATE_claude.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R09)` in the header, `Status: IN_PROGRESS`, commit first.
- Log: ONE short line per finished step to `.worktrees/logs/r09-claude.log`, format `YYYY-MM-DD HH:MM step N done: <max 10 words>`.
  No diffs, no file contents, no test output in the log.
- Owned files: `src/main/ext/system.js`, `src/renderer/status-widgets.js`, `src/renderer/status.css`, `src/renderer/menu.css`, `src/renderer/styles.css`,
  `src/renderer/index.html`, your state file. Nothing else.
- Other agents' files you use but must not edit: `backend/net-probe.js` (codex: `runSpeedTest`, `runUploadTest`, `SPEED_DURATION_MS`,
  `UPLOAD_DURATION_MS`), `src/renderer/speed-card-model.js` (copilot: `cardView`, `fadeOpacity`, `RESULT_HOLD_MS`, `FADE_MS`). If they are not on
  your branch yet, merge `main` after the coordinator merges them; until then write the code against the names above and say so in the state file.

## Goal

1. The Ethernet card is grey like the MK-PC card, with class `.qs-info`, no focus or hover rule on the card.
2. It contains one button, **Speed test**, class `.qs-speed-button`, focusable, with its own highlight rule (`.qs-speed-button:is(:focus, :focus-visible)`).
   The button is NOT a `.qs-row`. Its highlight does not move the card.
3. The speed state runs download (10 s) then upload (10 s). The result line reads `↓ x Mbps · ↑ y Mbps`. The card view comes from
   `SpeedCardModel.cardView` and `fadeOpacity`: `'ip'` shows the IP and ping line, `'result'` and `'fading'` show the result line; `'fading'` uses
   the opacity from `fadeOpacity`.

## Task items

1. `src/main/ext/system.js`: start the speed test with download then upload (`runSpeedTest`, then `runUploadTest`), publish `phase` and
   `downMbps`/`upMbps` in the state, keep cancel working for both phases. Keep the existing `getSpeedTest`, `startSpeedTest`, `cancelSpeedTest`
   names. Commit.
2. `status-widgets.js`: render the Ethernet card as in the contract: `.qs-info` card, `.qs-speed-button` inside it, the view from `cardView`
   with the fade. Remove the Ethernet card's focus and `tabindex`. Commit.
3. CSS (`status.css`, `menu.css`, `styles.css`): `.qs-info` grey, no focus rule; `.qs-speed-button` own highlight only; the `.qs-row` rule must not
   match the button (check the selectors). Keep the existing grey and text sizes of MK-PC. Commit.
4. `npm run check` (must pass, with the other branches merged when they exist). Commit the state file with `Status: DONE` or `PARTIAL`.
5. In the state file, under "Unverified": the card, the button highlight, the 10 + 10 s run and the 20 s hold are NOT checked on the real screen.

## Rules

- Commit after each task item, English messages, ending with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- Do not run Electron. Do not merge, push or touch `main`.
- Keep your final report short.
