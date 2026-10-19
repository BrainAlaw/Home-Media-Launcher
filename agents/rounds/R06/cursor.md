# R06 · cursor · Tier S

- Worktree: `D:\Github Repos\hml-r06-cursor` (branch `r06/cursor`). Work only here.
- Read first (exactly these): `AGENTS.md`, `src/main/admin/panel/panel.css`.
- State file: `agents/state/CURRENT_STATE_cursor.md`. Copy `agents/STATE_TEMPLATE.md`, set `Status: IN_PROGRESS`, commit before code.
- Owned files: `src/main/admin/panel/panel.css`, your state file. Nothing else. Do not touch `panel.js` or `index.html`; Claude is editing them.

## Goal

Polish the admin panel stylesheet for a phone (16 px side gutter, one column, no horizontal scroll), long read-only values, keyboard focus and
reduced motion. Keep every existing class name; other files use them (`.field`, `.field-wide`, `.field-help`, `.field-error`, `.object-value`).

## Task items

1. Long read-only values: the `.object-value` block (`<pre>`) wraps and never scrolls the page. Set `white-space: pre-wrap`,
   `overflow-wrap: anywhere`, `max-width: 100%`, `overflow-x: hidden`, `box-sizing: border-box`.
2. Phone layout: under `640px`, one column; the page has a `16px` side gutter (`padding-inline: 16px`); every element uses
   `box-sizing: border-box`; nothing gets a fixed width wider than the viewport (use `max-width: 100%`). Keep the desktop layout as it is.
3. Focus: every interactive element (`button`, `input`, `select`, `textarea`, `a`) has a visible `:focus-visible` outline, 2 px, with a 2 px offset.
   Do not remove any existing outline; only add `:focus-visible` rules.
4. Reduced motion: `@media (prefers-reduced-motion: reduce)` sets `transition` and `animation` to `none` (and `scroll-behavior: auto`) for the panel.

## Rules

- No external fonts, images or URLs (`url(http` and `@import` with a URL are forbidden). Colours stay as the custom properties already in the file.
- No automated test exists for CSS. Verify by reading the result. Do not claim a visual check.
- Run `npm test` (must pass, it does not cover CSS but nothing may break). Commit after each item with an English message ending with
  `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. Tick the item and commit the state file.
- In your state file write under "Unverified / not done": "not checked on a real display".

## Stop rules

- Stop (`Status: BLOCKED`) if the change needs a class name that does not exist in `panel.css` yet; list it under "Requests for the coordinator".
- Do not run Electron. Do not merge, do not push, do not touch `main`.
