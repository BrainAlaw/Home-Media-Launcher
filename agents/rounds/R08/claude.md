# R08 · claude · Tier L (runs as a subagent of the coordinator chat)

- Worktree: `.worktrees/r08-claude` (branch `r08/claude`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R08/PLAN.md` (the contract in it is fixed), `src/renderer/status-widgets.js` (the quick-settings
  network card and VPN rows), `src/renderer/status.css`, `src/renderer/menu.css` (focus rules, `#system-panel` and `.menu-toggle`, `.menu-action`).
- State file: `agents/state/CURRENT_STATE_claude.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R08)` in the header, `Status: IN_PROGRESS`, commit first.
- Log: append ONE short line per finished step to `.worktrees/logs/r08-claude.log`, format `YYYY-MM-DD HH:MM step N done: <what, max 10 words>`.
  No file contents, no diffs, no test output in the log. The watcher shows the last line.
- Owned files: `src/renderer/status-widgets.js`, `src/renderer/status.css`, `src/renderer/menu.css`, `src/renderer/styles.css`, `src/renderer/index.html`,
  your state file. Nothing else.

## Goal

1. The Ethernet card in Quick settings is information only: class `.qs-info`, no `tabindex`, no button role, no focus or hover rule. It looks like the `MK-PC` info in the header.
2. Tailscale, Surfshark and the switch rows (for example Start at login) use class `.qs-row`. All of them share ONE focus animation (the `.qs-row` rule in `PLAN.md`).
   Remove the separate focus rules for the VPN rows. Keep the visual look of a focused row the same as the current switch rows.

## Task items

1. In `status-widgets.js`, render the Ethernet card with `.qs-info` and without `tabindex` or `role="button"`. Other rows get `.qs-row`. Keep the existing
   text content. Commit.
2. In `menu.css` and `styles.css`, replace the focus rules for the VPN rows and the switch rows with the single `.qs-row` focus rule and the `.qs-info` rule
   (no focus). Remove the duplicate rules; do not change colours or timings. Commit.
3. In `status.css`, keep only the layout for `.qs-info` and `.qs-row`; remove focus rules from the card styles. Commit.
4. Run `npm run check` (must pass). If `test/quick-settings-focus.test.js` from copilot is not on this branch yet, that is fine: the coordinator merges it later.
   Commit the state file with `Status: DONE` if the code is finished, otherwise `PARTIAL`.
5. In the state file, say clearly under "Unverified": the focus animation and the Ethernet card are NOT checked on the real screen.

## Rules

- Commit after each task item. English commit messages, ending with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- Do not run Electron. Do not merge, push or touch `main`. Do not edit `src/renderer/quick-settings-model.js` (codex owns it); if you need it, use the contract names only.
- Keep the total report short: the state file and the final message are enough.
