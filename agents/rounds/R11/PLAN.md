# Round R11: mouse mode across the product

Goal: every control works with the mouse. A click does what Enter does, hover shows the same feedback everywhere, the wheel scrolls the
home tiles sideways, and the on-screen keyboard accepts mouse input. Keyboard and gamepad keep working exactly as before.

Base: `main` (after the audit `docs/MOUSE-AUDIT.md` and the hover fix of R10).

## Shared contract (fixed before work starts)

- `.pointer-target`: every clickable element. One hover style, defined once in `pointer-target.css` (new, loaded in `index.html`):
  `.pointer-target:hover` gets `background: var(--hig-fill)` and `cursor: pointer`. Focus styles stay as they are.
- Elements that are not buttons but become clickable get `role="button"`, `tabindex="-1"` and the class `.pointer-target`. Keyboard focus
  still goes through the existing focus list; `tabindex="-1"` keeps them out of Tab order.
- `src/renderer/mouse-mode-model.js` (codex, new) exports:
  - `wheelToHorizontal({ deltaX, deltaY })` returns `deltaX || deltaY` (the vertical wheel scrolls a horizontal track);
  - `clickAction(element)` returns `'activate'` for buttons and `.pointer-target` elements, `null` otherwise.
  It is a UMD module (`module.exports` plus `window.MouseModeModel`), wrapped in an IIFE.

## Owners

| Agent | Runs as | Worktree | Branch | Task |
|---|---|---|---|---|
| `codex` | Codex CLI (M) | `.worktrees/r11-codex` | `r11/codex` | `mouse-mode-model.js` with tests; media widget click activates the action |
| `copilot` | Copilot CLI (S) | `.worktrees/r11-copilot` | `r11/copilot` | pairing wizard and controller list: click, hover, role |
| `opencode` | OpenCode CLI (S) | `.worktrees/r11-opencode` | `r11/opencode` | settings: generated choices get `.pointer-target` and click |
| `cursor` | Cursor agent (S) | `.worktrees/r11-cursor` | `r11/cursor` | styles for the settings, pairing and controllers pages only |
| `claude` | subagent of the coordinator chat (L) | `.worktrees/r11-claude` | `r11/claude` | home screen clicks and hover, wheel on tiles, `pointer-target.css`, `index.html`, keyboard overlay pointer input |

## Ownership map

| File | Owner |
|---|---|
| `src/renderer/mouse-mode-model.js` (new), `test/mouse-mode-model.test.js` (new), `src/renderer/media-widget.js`, `test/media-widget-mouse.test.js` (new) | codex |
| `src/renderer/pairing-wizard-ui.js`, `src/renderer/controllers-page.js`, `src/renderer/controller-list.js`, `test/controllers-mouse.test.js` (new) | copilot |
| `src/renderer/settings.js`, `src/renderer/settings-appearance.js`, `test/settings-mouse.test.js` (new) | opencode |
| `src/renderer/settings-apps.css`, `src/renderer/appearance.css`, `src/renderer/controllers.css` | cursor |
| `src/renderer/app.js`, `src/renderer/index.html`, `src/renderer/pointer-target.css` (new), `src/renderer/home.css`, `src/renderer/styles.css`, `src/renderer/on-screen-keyboard.js`, `test/home-mouse.test.js` (new) | claude |
| `agents/state/CURRENT_STATE_<agent>.md` | each agent |

`index.html` is claude's alone: every new script and stylesheet any agent needs is added there by claude, after the other branches are merged.

## Merge order

1. `codex`, `copilot`, `opencode`, `cursor` (independent; merge as they finish).
2. `claude` (uses the model and the styles; adds the `index.html` links).
3. Coordinator: `npm run check`. Then the user checks on the PC: clicks on tiles, the media card, pairing, controllers, settings choices;
   hover on every clickable element; the wheel on the home tiles; typing with the mouse on the on-screen keyboard; keyboard and gamepad still work.

## Risks

- Keyboard and gamepad regressions: every prompt says the keyboard path must stay unchanged.
- Visual changes can only be judged on the PC screen. Nothing is claimed as verified before that.
