# CURRENT_STATE_claude (round R11)

Status: PARTIAL            <!-- IN_PROGRESS | DONE | PARTIAL | BLOCKED | OUT_OF_BUDGET -->
Agent: claude  ·  Tool: Claude Code (subagent)  ·  Branch: r11/claude  ·  Last update: 2026-10-19

## Tasks
- [x] 1. pointer-target.css with .pointer-target:hover, linked in index.html (commits 5fc4f7a, bc69fac). The mouse-mode-model.js script tag is not added: the file is not on this branch yet.
- [x] 2. Home screen: tile click = Enter, tiles get .pointer-target (commit 4777e90)
- [x] 3. Home wheel: vertical wheel over a tile track scrolls it sideways (commit 9a79963), inline mapping
- [~] 4. On-screen keyboard: key hover focus added (commit 608bcb5). Caret placement by click NOT done, see Unverified.
- [x] 5. test/home-mouse.test.js: wheel mapping, tile click path = Enter path, pointer-target wiring (commit 3121438)
- [x] 6. npm run check passes (687 tests, 0 failures)

## Done
- pointer-target.css: `.pointer-target:hover` (hig-fill background, pointer cursor); linked in index.html — commits `5fc4f7a`, `bc69fac`
- Home: click on `.focusable` now does `setFocus` + `handleAction('confirm')` (same path as Enter); tiles are `tile pointer-target`; `.tile.pointer-target:hover` keeps `background: none` in home.css — commit `4777e90`
- Home wheel: `homeWheelToHorizontal` (deltaX || deltaY) plus a wheel listener on `#rows` that scrolls the `.track` and passes through at the ends — commit `9a79963`
- OSK: mouse movement over a key moves the key highlight (mouse pointer type only) — commit `608bcb5`
- Tests: `test/home-mouse.test.js` (4 tests, source-level plus VM for the mapping) — commit `3121438`

## Verified
- `npm run check`: 687 tests pass, 0 fail (run inside the worktree).
- `node --test test/home-mouse.test.js`: 4 pass.

## Unverified / not done
- not checked on a real display (hover fill, tile hover, wheel scroll, OSK hover were not seen on screen; Electron not run per the prompt).
- OSK caret placement by click is NOT implemented. `keyboard-layout.js` has no caret index: `insert`, `backspace` and `press` only append to `text`, so the caret is always at the end. Clicking the field leaves it at the end. Mouse typing works through the existing key buttons (they already accepted clicks). A real mid-text caret needs a cursor index in `keyboard-layout.js` (not owned by this round).
- OSK key buttons do not get `.pointer-target`: they already had hover feedback per the audit, and `on-screen-keyboard.css` is not in my owned files, so their fill was not changed.
- Home pointer hover focus (`pointermove` on `.focusable`) already existed before this round; it is kept unchanged.
- `mouse-mode-model.js` (codex) is not on this branch. The wheel mapping is inline in `app.js` as `homeWheelToHorizontal`; once the coordinator merges codex, it can be swapped for `MouseModeModel.wheelToHorizontal` and the script tag added to index.html.
- Media widget click (activate action) is codex's (media-widget.js). The home click handler only handles `.focusable` elements, so the widget is not affected by this round's code.

## Files changed
- src/renderer/pointer-target.css — new, shared hover rule
- src/renderer/index.html — stylesheet link for pointer-target.css
- src/renderer/app.js — tile class, click path, wheel mapping and listener
- src/renderer/home.css — tile hover override for the shared fill
- src/renderer/on-screen-keyboard.js — pointermove highlight on keys
- test/home-mouse.test.js — new tests
- agents/state/CURRENT_STATE_claude.md — this file

## Requests for the coordinator
- After merging codex: replace `homeWheelToHorizontal` with `MouseModeModel.wheelToHorizontal` (optional), and add `<script src="mouse-mode-model.js"></script>` to index.html (the claude branch does not include it).
- Future round: add a caret index to `keyboard-layout.js` (insert/backspace/press at a position) before the OSK field can take a mouse caret placement.
- Settings: no user-facing setting was added in this round.

## Resume notes
- Caret placement on the OSK text field: needs the `keyboard-layout.js` change above; then `on-screen-keyboard.js` field click handler maps the click x-position to a caret index.
