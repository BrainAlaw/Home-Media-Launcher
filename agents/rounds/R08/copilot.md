# R08 · copilot · Tier S

- Worktree: `.worktrees/r08-copilot` (branch `r08/copilot`). Work only here.
- Read first (at most three files): `AGENTS.md`, `agents/rounds/R08/PLAN.md`, `src/renderer/menu.css` (search for `focus`).
- State file: `agents/state/CURRENT_STATE_copilot.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R08)` in the header, `Status: IN_PROGRESS`, commit first.
- Log: append one short line per finished step to `.worktrees/logs/r08-copilot.log`. No file contents in the log.
- Owned files: `test/quick-settings-focus.test.js` (new), your state file. Nothing else.

## Goal

A static test that enforces the focus contract from `PLAN.md`: one focus rule for `.qs-row`, no focus rule for `.qs-info`, and no separate focus rules
for the VPN rows. It reads the renderer files as text.

## Task items

1. Create `test/quick-settings-focus.test.js` (`node:test`, `node:assert/strict`). Read `src/renderer/menu.css`, `src/renderer/styles.css`,
   `src/renderer/status.css` and `src/renderer/status-widgets.js` as text. Checks:
   - every selector that contains `:focus` or `:focus-visible` or `:focus-within` and mentions `.qs-row` uses the same declaration block
     text as the one selector `.qs-row:is(:focus, :focus-visible)`; to keep it simple, check that the string `.qs-row` appears in at least one focus selector;
   - no focus selector mentions `.qs-info`;
   - no focus selector mentions `#tailscale`, `#surfshark`, `.vpn` or `tailscale-indicator`/`surfshark-indicator` (the VPN rows must use `.qs-row`).
   Fail with a message naming the file and the selector.
2. Run `npm test` (the test will fail until claude is merged; that is expected for this branch). Commit after the item with an English message ending with
   `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item in your state file and commit it.
3. Set `Status: DONE`, fill every section, commit. In "Unverified" write: "passes only after r08/claude is merged".

## Stop rules

- Do not run Electron. Do not edit any other file. Do not merge, push or touch `main`.
