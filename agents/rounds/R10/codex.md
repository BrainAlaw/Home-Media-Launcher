# R10 · codex · Tier M (read-only audit)

- Worktree: `.worktrees/r10-codex` (branch `r10/codex`). Work only here. You change NO code, only the audit document.
- Read first: `AGENTS.md`, `agents/rounds/R10/PLAN.md`. Then read the renderer: `src/renderer/index.html`, `app.js` (the input handling, `handle`,
  `moveFocusAmong`, `menuItems`), `navigation-menu.js`, `home.css`, `styles.css`, `media-widget.js`, `settings.js` and `settings-appearance.js`
  (the pointer handlers), `icon-popup.js`, `on-screen-keyboard.js`, `pairing-wizard-ui.js`, `controllers-page.js`, `remote-input.js`.
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R10)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.
- Owned files: `docs/MOUSE-AUDIT.md` (new), your state file. Nothing else.

## Goal

A written audit of mouse support across the product: every screen, every control kind, and what happens with the mouse today.
Mouse mode is planned from this document later, so be exact and short.

## Document structure (`docs/MOUSE-AUDIT.md`)

1. **Screens** (home, Quick settings, Settings pages, pairing, controllers, on-screen keyboard, icon popup, media widget, launch overlay):
   one row each.
2. **Per screen, a table** with columns: control | mouse click works (yes / no / partly) | hover feedback (yes / no) | wheel scroll (yes / no / not needed) |
   file:line of the handler or the missing handler.
3. **Gaps grouped** into: (a) no pointer handler at all, (b) handler exists but does not match the keyboard action, (c) hover feedback missing,
   (d) scroll containers that do not respond to the wheel.
4. **Not verified**: say which claims come only from reading the code (all of them, since no app run is allowed in this round).

## Task items

1. Read the files listed above. Write the screen list and the home and Quick settings sections. Commit.
2. Write the Settings, pairing, controllers, keyboard, icon popup and media sections. Commit.
3. Write the gaps list with file:line references, and the "not verified" section. Commit.
4. Set `Status: DONE`, fill the state file, commit.

## Rules

- Do not run Electron. Do not edit any code file. Do not merge, push or touch `main`.
- Keep the document short: one table row per control, no prose beyond what is needed.
