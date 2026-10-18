# R02 · claude · Tier L

- Worktree: `D:\Github Repos\hml-r02-claude` (branch `r02/claude`).
- State file: `agents/state/CURRENT_STATE_claude.md`.
- Owned files: `scripts/e2e/web-app-check.cjs` (new), `scripts/e2e/fixtures/**` (new), your state file.

## Goal

A repeatable check of stage A on the real display: open a local test page as a fullscreen website window from the launcher, drive it with a scripted virtual pad, check that the page received the right keys, check that a long Home press returns to the launcher, and capture the real display at each step.

## Tasks (commit after each, tick it in your state file)

1. Fixture `scripts/e2e/fixtures/keys.html`: a page that lists every key event it receives (key, code, repeat, isTrusted) into a visible log and into `document.title`, plus a focusable grid of 3x3 buttons that highlights the focused one on arrow keys and clicks it on Enter.
2. Harness `scripts/e2e/web-app-check.cjs` (follow `scripts/e2e/gamepad-e2e.cjs` for boot, pad install and capture). It adds a temporary website tile pointing at the fixture (a `file:` URL is fine if the launcher accepts it; if not, serve it with a tiny local `http` server on 127.0.0.1 and report that). It must not write the temp tile into the user's real config: use the temp profile copy.
3. Scenarios: D-pad right x2 then down: the fixture reports ArrowRight, ArrowRight, ArrowDown, with isTrusted true; A reports Enter; B reports Escape as a tap; long Home (hold 900 ms, `Home` key via `webContents.sendInputEvent` keyDown/keyUp, or the remote-keymap route if the key cannot be injected that way) closes the window and the launcher is visible again; short Home (150 ms) does not close.
4. Run it from the main checkout once codex has merged (`HML_E2E_ROOT`, see R01 notes). Until then, run what can run and record what is blocked.
5. Read every screenshot. Report to the coordinator: pass/fail per scenario, screenshots, and any page behaviour that needs attention.

Do not change app code (`src/`). If a bug is found, write it under "Requests for the coordinator" with file and function.
