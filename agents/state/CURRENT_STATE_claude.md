# CURRENT_STATE_claude (round R10)

Status: DONE            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code (subagent, Tier L)  ·  Branch: r10/claude  ·  Last update: 2026-10-19 11:58

## Tasks
- [x] 1. Hover fix: every Quick settings row (static and VPN) gets the same JS motion (design a, see Done)
- [x] 2. Remove the CSS transform rules that conflict with the JS motion on .qs-row
- [x] 3. npm run check passes; state file set to final status

## Done
- Design (a) chosen: VPN rows are registered with the navigation menu as they appear. A MutationObserver on the system panel calls
  `register()` for every added `.menu-action`, so the VPN rows get the same inline spring motion as Settings and Start at login. — commit `cf7f673`
- Design (b) rejected: the JS motion for a row also drives the press scale, the focus spring and the content slide. Removing the
  inline transform would drop those on the static rows, which is a visual change, so the no-visual-change condition of (b) is not met.
- The CSS `transform` in the `.qs-row` focus/hover rule and in the `.qs-row` icon hover rule was dead (inline value wins) and
  conflicting; removed. Background, z-index and chevron rules kept. — commit `e25cd9f`
- `createVpnRow` in `status-widgets.js` needed no change (registration happens in `navigation-menu.js`).

## Verified
- `npm run check` in the worktree: exit 0, 683 tests pass, 0 fail.
- By reading the code: static rows and VPN rows both get the inline transform from `track()`; no other rule sets `transform` on `.qs-row`
  (checked `styles.css`, `menu.css`, `status.css`; the `.menu-toggle` knob transform is on `.switch-knob`, not the row).

## Unverified / not done
- The hover is NOT checked on the real screen. Electron was not run (per rules). The coordinator must check on the PC that the VPN rows hover like Settings.
- Coordinator note: the static rows' look may change slightly. The icon no longer gets a CSS lift on any row (it never did on static rows),
  and the row lift is now the JS scale 1.045, which VPN rows now share.

## Files changed
- `src/renderer/navigation-menu.js` — MutationObserver registers rows added later; disconnected in `dispose()`.
- `src/renderer/styles.css` — removed dead `transform` from the `.qs-row` hover rule and icon hover rule; comment updated.

## Requests for the coordinator
- None blocking. Mouse audit (codex) is separate.

## Resume notes
- Complete. Next step is the real-display check of the VPN rows hover on the PC.
