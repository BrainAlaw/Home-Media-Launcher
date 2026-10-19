# R06 · opencode · Tier S

- Worktree: `D:\Github Repos\hml-r06-opencode` (branch `r06/opencode`). Work only here.
- Read first (exactly these): `AGENTS.md`, `src/main/admin/panel/index.html`, `src/main/admin/static.js` (only the `resolvePanelFile` part).
- State file: `agents/state/CURRENT_STATE_opencode.md`. Copy `agents/STATE_TEMPLATE.md`, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `test/admin-panel-security.test.js` (new), your state file. Nothing else.

## Goal

The admin panel is served under `default-src 'self'`, so it must have no inline script, no `eval`, no inline event handlers, and no
external references. This test enforces that on every file in the panel folder, so later rounds cannot break it silently.

## Task items

1. Create `test/admin-panel-security.test.js` (`'use strict'`, `node:test`, `node:assert/strict`). Read the panel folder
   `path.join(__dirname, '..', 'src', 'main', 'admin', 'panel')` with `fs.readdirSync`, keep `.html`, `.js` and `.css` files, and fail
   if the folder has none.
2. HTML rules, per `.html` file. Fail with the file name and line number when any of these match:
   - a `<script>` tag with no `src=` attribute, unless it has `type="application/json"`;
   - an inline event handler: `/\son[a-z]+\s*=/i`;
   - a `style=` attribute (blocked by `default-src 'self'`; use a class instead);
   - `javascript:` anywhere;
   - an external reference: `/(src|href)\s*=\s*["']?(https?:)?\/\//i`.
   Also, every relative `src=` or `href=` (`/(src|href)="([^"]+)"/`, not starting with `http`, `data:` or `#`) must name a file that exists in
   the panel folder.
3. JS and CSS rules, per `.js` and `.css` file. Fail on: `eval(`, `new Function(`, `innerHTML`, `insertAdjacentHTML`, `document.write`,
   `url(http`, `@import` with a URL, `expression(`. Strip `//` line comments and `/* */` block comments before matching, so a comment that
   mentions one of these words does not fail the test.
4. Run `node --test test/admin-panel-security.test.js` and `npm test`. Both must pass on the current panel sources. If a real violation exists
   in the current panel, do not edit the panel: write the file, line and rule under "Requests for the coordinator" and set `Status: PARTIAL`.
   Commit after each item with an English message ending with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item and commit
   the state file.
5. Set `Status: DONE` (or `PARTIAL` per item 4) in your state file, fill every section, commit.

## Stop rules

- Stop (`Status: BLOCKED`) if the work grows past about 150 changed lines.
- Do not run Electron. Do not merge, do not push, do not touch `main`.
