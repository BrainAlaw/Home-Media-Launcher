# CURRENT_STATE_claude (round R02)

Status: PARTIAL            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code  ·  Branch: r02/claude  ·  Last update: 2026-10-19

## Tasks
- [x] 1. Fixture `scripts/e2e/fixtures/keys.html` (key log, 3x3 grid)
- [x] 2. Harness `scripts/e2e/web-app-check.cjs` (temp profile, temp website in the Gaming category, 127.0.0.1 server)
- [x] 3. Scenarios run: keyboard arrows, Enter, Escape, short Home, long Home (pad steps blocked, see below)
- [x] 4. Run from the main checkout with the merged codex branch (`HML_E2E_ROOT`)
- [x] 5. Screenshots read; report written

## Results (run web-2026-10-19, 6 steps: 5 ok, 1 blocked, 0 failed)
- arrows Right, Right, Down reach the page (trusted=false, injected): ok
- Enter tap: ok
- Escape tap: ok
- short Home (150 ms): window stays open: ok
- long Home (900 ms): window closes, launcher visible: ok
- pad D-pad, A, B: BLOCKED (the scripted `navigator.getGamepads` cannot reach the isolated preload)

## Verified
- Screenshot `02-key-arrow-right-right-down.png` on the second monitor: key log shows the three keys and the highlight moved to cell 6.
- Screenshot `06-home-long-returns-to-launcher.png`: the launcher is back.

## Unverified / not done
- Pad steps (needs a real controller or a test hook in the preload).
- Remote Back (`BrowserBack`): not in this harness; the main process now steps back in history (see Requests).

## Files changed
- `scripts/e2e/fixtures/keys.html` — new, key-log test page.
- `scripts/e2e/web-app-check.cjs` — new, stage A harness.

## Requests for the coordinator
1. **[L] Home Theatre websites do not get the remote keymap.** Websites in the Home Theatre category (Netflix, YouTube, Twitch, ...) open through `openTvWebsite` / `TvBrowserSession` (`src/main/index.js` around line 295), not `openWebsite`. Codex wired the keymap only into `openWebsite`, so the main use case is not covered. Needs the same keymap argument on the TV browser's preload (see `src/main/spotify-web-preload.js` for the pattern).
2. **[S] The pad path cannot be tested with a scripted navigator.** The preload runs in an isolated world; use a real controller, or add a test-only hook behind an environment flag.
3. **[S] Injected keys are untrusted.** Electron's `sendInputEvent` gives `isTrusted: false` in the page. Real remote keys come from the OS and are trusted; some pages ignore untrusted events, so check with a real remote.
4. Back policy was changed by the coordinator (remote Back = history back, never closes); `remote-keymap.json` no longer maps Back keys.

## Resume notes
Item 1 is the next step for stage A. After it lands, add a Home Theatre scenario (`category` unset) to the harness.
