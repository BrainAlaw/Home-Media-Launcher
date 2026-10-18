# R01 · opencode · Tier S

- Worktree: `D:\Github Repos\hml-opencode` (branch `r01/opencode`). Work only here.
- State file: `agents/state/CURRENT_STATE_opencode.md` (copy `agents/STATE_TEMPLATE.md`, create it **before** writing code, commit it).
- Owned files: `src/renderer/launch-session.js`, `test/launch-session.test.js`, two lines of `src/renderer/app.js` (below), your state file. Do not edit anything else.

## Goal

Remove two pieces of dead code left over from a removed feature (the old "hero" banner). Behaviour must not change.

## Facts you need (do not search for them)

- `src/renderer/launch-session.js` defines `function createHeroBinding({ onHero })` in a section headed by the comment `grid → hero binding`, and lists `createHeroBinding` in its returned export object (`return { createHeroBinding, buildLaunchConfig, createLaunchSession, describeLaunchError... }`). Nothing in `src/` calls it; only `test/launch-session.test.js` does.
- `test/launch-session.test.js` imports it on the line `const { createHeroBinding, buildLaunchConfig, createLaunchSession } = require('../src/renderer/launch-session');` and has two tests that call `createHeroBinding(...)`.
- `src/renderer/app.js` lines 71-72 are exactly:
  ```js
  const motionScheduler = new window.MenuMotion.CompositorScheduler({ reducedMotion: reducedMotionQuery.matches });
  reducedMotionQuery.addEventListener('change', (event) => motionScheduler.setReducedMotion(event.matches));
  ```
  `motionScheduler` is not used anywhere else. **Keep** line 70 (`const reducedMotionQuery = ...`): it is still used on line 74.

## Tasks (commit after each, tick it in your state file)

1. Delete `createHeroBinding` (the whole function, its section comment and helper code used only by it) and remove it from the export object. Remove the two tests that use it and drop it from the test's import line. Run `npm test`.
2. Delete the two `app.js` lines quoted above. Before deleting, search `src/` for `motionScheduler` to confirm there is no other use; if there is, stop and report `Status: BLOCKED`. Run `npm run check`.
3. Finish the state file with `Status: DONE` and the number of lines removed.
