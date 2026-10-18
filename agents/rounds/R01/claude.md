# R01 · claude · Tier L

- Worktree: `D:\Github Repos\hml-claude` (branch `r01/claude`). Work only here during the round; merging of the other branches happens later, when the user asks for the next actions in the main checkout.
- State file: `agents/state/CURRENT_STATE_claude.md` (from `agents/STATE_TEMPLATE.md`, create it first).
- Owned files: `CURRENT_STATE.md`, `scripts/e2e/**` (new), `.gitignore`, your state file.

## Tasks (commit after each, tick it in your state file)

1. **Clean `CURRENT_STATE.md`.** Remove or mark as fixed the stale entries (the "Not fixed (low/medium)" review list and known issues 5 and 7 were fixed in iteration 6; the Git section still mentions 409 tests). Keep it accurate and short; do not lose unverified items.
2. **Gamepad end-to-end harness** `scripts/e2e/gamepad-e2e.cjs`: an Electron entry that copies the real config (`config.json`, `remote-apps.json`, `themes.json`, never token files' contents in logs) into a temp profile, starts the app fullscreen, replaces `navigator.getGamepads` with a scripted virtual pad (standard mapping: buttons 0 A, 1 B, 9 Start, 12-15 D-pad), and runs scenarios: home rows navigation; widget focus and controls; music view open/close; on-screen keyboard typing into a settings field; icon popup open/close; quick settings switches. Capture the real display after each scenario with `desktopCapturer` (window always-on-top), record renderer console errors, and write a JSON plus Markdown report to `scripts/e2e/out/` (git-ignored).
3. **Run it** on the dev machine and read every screenshot. Write the bugs found, grouped by file/subsystem and tagged S/M/L, into the state file as the input for R02.
4. Finish the state file with `Status: DONE`.
