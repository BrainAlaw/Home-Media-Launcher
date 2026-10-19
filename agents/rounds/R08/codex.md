# R08 · codex · Tier M

- Worktree: `.worktrees/r08-codex` (branch `r08/codex`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R08/PLAN.md`, `src/renderer/status-format.js` (the `status.type` values, e.g. `'ethernet'`),
  `src/renderer/status-widgets.js` (the `module.exports` and `window.` pattern at the top of the file, to copy).
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R08)` in the header, `Status: IN_PROGRESS`, commit first.
- Log: append one short line per finished step to `.worktrees/logs/r08-codex.log` (create the folder if missing). No file contents in the log.
- Owned files: `src/renderer/quick-settings-model.js` (new), `test/quick-settings-model.test.js` (new), your state file. Nothing else.

## Goal

Pure logic that decides, for one Quick settings entry, whether it is focusable (`'focusable'`) or informational (`'info'`). The renderer
uses it to choose the class `.qs-row` or `.qs-info`.

## Interface (keep exactly)

- `rowKind(entry)` returns `'info'` when `entry.type === 'ethernet'`, otherwise `'focusable'` when `entry.kind` is one of
  `'vpn'`, `'toggle'`, `'action'`. Any other `entry.kind` throws `TypeError` naming the kind.
- `rowClass(entry)` returns `'qs-info'` or `'qs-row'` from `rowKind(entry)`.
- Export both from CommonJS (`module.exports`) and expose the same object as `window.QuickSettingsModel` when `window` exists (same pattern as
  `status-widgets.js`). Wrap the file in an IIFE so no top-level name clashes with other renderer scripts (`test/renderer-globals.test.js` checks this).

## Task items

1. Create `src/renderer/quick-settings-model.js` with the interface above, under 80 lines.
2. Create `test/quick-settings-model.test.js` (`node:test`): ethernet is info; vpn, toggle and action are focusable; an unknown kind throws;
   `rowClass` returns the matching class; the `window` export is present when a fake `window` is set up in a `vm` context.
3. Run `npm run check` (must pass). Commit after each item, English messages, ending with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
   Tick the item in your state file and commit it.
4. Set `Status: DONE`, fill every section, commit. In "Requests for the coordinator" write the exact export names.

## Stop rules

- Do not run Electron. Do not touch `status-widgets.js`, the CSS or `index.html` (claude owns them). Do not merge, push or touch `main`.
