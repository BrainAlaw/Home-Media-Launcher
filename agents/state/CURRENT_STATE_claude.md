# CURRENT_STATE_claude (round R08)

Status: DONE            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code (subagent of the coordinator chat)  ·  Branch: r08/claude  ·  Last update: 2026-10-19 11:45

## Tasks
- [x] 1. Ethernet card (`#network-card`) becomes `.qs-info`: no tabindex, no button role, layout only
- [x] 2. Tailscale, Surfshark, switch and action rows get `.qs-row`; one focus rule in menu.css and styles.css; VPN focus rules removed
- [x] 3. status.css keeps only layout for `.qs-info` and `.qs-row`; focus rules removed from card styles
- [x] 4. `npm run check` passes; state file set to DONE

## Done
- Ethernet/network card is `div#network-card.qs-info` (no tabindex, no role, no aria-label set from JS) — commit `29d8218`
- Settings, Start at login, VPN rows (Tailscale, Surfshark), Exit and Power off carry `.qs-row`; one focus and hover rule in `menu.css` and `styles.css` — commit `e011e74`
- `status.css`: `.qs-info` layout block; the VPN-only focused-symbol rule is now `.qs-row[data-state="on"][data-focused="true"]` — commit `d6f4261`
- Colours and timings unchanged.

## Verified
- `npm run check` passes: 668 tests, 668 pass, 0 fail (no `test/quick-settings-focus.test.js` on this branch; copilot's test merges later).
- Static check only: `grep` confirms no `tabindex` or `role="button"` on `#network-card`, no focus selector left on `.menu-action` or `.menu-toggle:focus-within` in menu.css and styles.css.

## Unverified / not done
- Unverified: the focus animation and the Ethernet card are NOT checked on the real screen. Electron was not run (per rules).
- Deviation from the plan wording: the focus rule has `:hover` in its own selector, kept so pointer hover looks the same as before. Declarations are identical to the focus rule.
- The VPN rows had no separate focus rule in `menu.css` or `styles.css`; the only VPN-specific focus-state rule was in `status.css`, now generalised to `.qs-row`.

## Files changed
- `src/renderer/index.html` — network card to `div.qs-info`; `qs-row` on settings, autostart, quit, poweroff
- `src/renderer/status-widgets.js` — dropped the per-paint `aria-label` on the network card; VPN rows get `qs-row`
- `src/renderer/menu.css` — focus/hover reset rule keyed to `.qs-row`
- `src/renderer/styles.css` — focus, hover, symbol and chevron rules keyed to `.qs-row`
- `src/renderer/status.css` — `.qs-info` layout block; `.qs-row` focused-symbol rule
- `agents/state/CURRENT_STATE_claude.md` — this file (it overwrote the R07 claude state file; the old content is in git history)

## Requests for the coordinator
- The network card was the only speed-test trigger in Quick settings. It is now information only, so the speed test cannot be started with the remote. The click listener is kept for pointer users. Decide whether the speed test gets its own focusable `.qs-row` action or stays mouse-only.
- Merge order: copilot's `test/quick-settings-focus.test.js` must be checked against the `.qs-row` and `.qs-info` names used here.

## Resume notes
- Nothing open. Next step, if any: the coordinator checks focus and the Ethernet card on the real screen.
