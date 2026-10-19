# R10 · claude · Tier L (runs as a subagent of the coordinator chat)

- Worktree: `.worktrees/r10-claude` (branch `r10/claude`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R10/PLAN.md`, `src/renderer/navigation-menu.js` (`register`, `track`, the `focusin` handler),
  `src/renderer/status-widgets.js` (`createVpnRow`, the VPN list handling), `src/renderer/styles.css` (the `.qs-row:hover` rule).
- State file: `agents/state/CURRENT_STATE_claude.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R10)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines. The coordinator reads your state file and commits.
- Owned files: the five renderer files named in `PLAN.md`, your state file. Nothing else.

## Goal

Tailscale and Surfshark rows hover exactly like Settings and Start at login. Choose ONE of these two designs and say which one in the state file:
(a) register VPN rows with `navigation-menu` when they are created, exactly like the static rows; or
(b) stop the JS motion from writing `transform` on `.qs-row` elements and let the CSS `:hover` and `:focus` rules do the lift.
Prefer (b) if it removes the inline transform for every row with no visual change on the static rows; check that the focus animation still works.

## Task items

1. Make the change (a or b). Verify by reading the code that every `.qs-row` gets the same hover and focus transform, static or VPN. Commit.
2. Check that no other rule (`.vpn-row`, `.menu-toggle`, `.menu-action`) sets a transform on `.qs-row:hover`. Remove a conflicting rule if one exists. Commit.
3. Run `npm run check` (must pass). Commit the state file with `Status: DONE`, or `PARTIAL` if the design choice could not be finished.
4. Under "Unverified", write: the hover is NOT checked on the real screen.

## Rules

- Commit after each item, English messages, ending with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- Do not run Electron. Do not merge, push or touch `main`.
- Keep the final report short.
