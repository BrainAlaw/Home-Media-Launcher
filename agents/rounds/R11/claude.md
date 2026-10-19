# R11 · claude · Tier L (runs as a subagent of the coordinator chat)

- Worktree: `.worktrees/r11-claude` (branch `r11/claude`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R11/PLAN.md` (the contract is fixed there), `docs/MOUSE-AUDIT.md` (sections a, b, c, d for the home
  screen and the on-screen keyboard), `src/renderer/app.js` (`moveFocusAmong`, `moveHome`, the home pointer handlers around lines 830-840, `setFocus`),
  `src/renderer/home.css` (the virtual track and the tile hover), `src/renderer/on-screen-keyboard.js` (lines around 106-110 and 181-194),
  `src/renderer/index.html` (the script and stylesheet list).
- State file: `agents/state/CURRENT_STATE_claude.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R11)` in the header, `Status: IN_PROGRESS`, commit first.
- No log lines.
- Owned files: `src/renderer/app.js`, `src/renderer/index.html`, `src/renderer/pointer-target.css` (new), `src/renderer/home.css`, `src/renderer/styles.css`,
  `src/renderer/on-screen-keyboard.js`, `test/home-mouse.test.js` (new), your state file. Nothing else.
- Other agents' files: `mouse-mode-model.js` (codex) and the page files (copilot, opencode, cursor). Use their names only when they are on your branch
  after the coordinator merges them. Until then write your code without depending on them and say so in the state file.

## Task items

1. Create `src/renderer/pointer-target.css` with the `.pointer-target:hover` rule and `cursor: pointer`, as in the contract. Add its `<link>` in `index.html`
   and the `<script>` tags for `mouse-mode-model.js` once it exists. Commit.
2. Home screen: a click on a tile activates it (the same path as Enter); the hover over a tile focuses it as the audit describes, without changing the
   keyboard path. Tiles get `.pointer-target`. Commit.
3. Home screen wheel: a vertical wheel over the tile track scrolls it horizontally, through `wheelToHorizontal` (codex) or, until that is on your branch,
   the same one-line mapping inline. Commit.
4. On-screen keyboard: a mouse click on the text field places the caret and typing with the mouse inserts characters, using the existing key buttons and
   the existing text state. The physical keyboard path stays unchanged. Commit.
5. Test in `test/home-mouse.test.js`: the wheel mapping (deltaY becomes horizontal), that the tile click path is the same function as Enter. Commit.
6. Run `npm run check` (must pass). Commit the state file with `Status: DONE` or `PARTIAL`. Under "Unverified" write: "not checked on a real display".

## Rules

- Commit after each item, English messages, ending with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- Do not run Electron. Do not merge, push or touch `main`.
- Keep the final report short.
