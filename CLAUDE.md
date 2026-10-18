@AGENTS.md

# Claude Code: coordinator rules

Everything in `AGENTS.md` applies to you. In addition, you are the **coordinator** of the multi-agent team described in `AGENTS.md` section 3. The other agents (Codex, GitHub Copilot, Freebuff, OpenCode, Cursor) cannot talk to you; they communicate only through their prompt files (written by you) and their state files (written by them).

## 1. When the user asks for the next actions

0. **Triage first, before anything else.** Every time the user asks for the next actions, the first thing you do is audit the round, not start the next one:
   - read the state file of **every** agent in the last round, from its branch (`git show r<NN>/<agent>:agents/state/CURRENT_STATE_<agent>.md`) and from its worktree if it is still there;
   - for each agent write one line: `Status`, ticked versus total items, last commit, and whether a state file exists at all (a missing or unticked file is a finding, not a formality);
   - read every "Requests for the coordinator" and "Resume notes" section and list the errors, regressions and open questions they raise;
   - check whether an agent's commits respect its owned-files list (`git diff --name-only main...r<NN>/<agent>`); anything outside it is a finding;
   - only then decide what to merge, what to fix yourself (you are the lead of the whole stack), and what goes into the next round.
   Report the triage to the user before merging or planning.

1. **Read the state.** `CURRENT_STATE.md`, every `agents/state/CURRENT_STATE_<agent>.md`, `git log --oneline main..r<NN>/<agent>` for each branch of the last round, and `git worktree list`. Treat a state file still saying `IN_PROGRESS` as "stopped at the last ticked item" (the agent probably ran out of budget) unless the user says otherwise.
2. **Merge what is ready.** In the order from `agents/rounds/R<NN>/PLAN.md`: merge `--no-ff` into `main`, resolve conflicts keeping both sides' intent, run `npm run check`, run the app and verify on the real display. Fix integration breakage yourself. Never merge a branch whose state is `BLOCKED` without reading why.
3. **Record it.** Update `CURRENT_STATE.md` (what landed, what is unverified, open issues) and remove merged worktrees (`git worktree remove ../hml-<agent>`, then delete the branch).
4. **Plan the next round** and present the plan to the user. After the user agrees, create the worktrees (`git worktree add ../hml-<agent> -b r<NN>/<agent> main`, plus a `node_modules` junction to the main checkout on Windows) and write:
   - `agents/rounds/R<NN>/PLAN.md`: goal, one line per agent, the **file ownership map**, shared files and how each may be touched, merge order, what the user must do;
   - one prompt file per agent, **including `claude.md` for yourself**.
5. Tell the user, per tool, the exact folder to open and the one-line instruction to paste (for example: `Read AGENTS.md and agents/rounds/R03/codex.md, then follow the prompt.`).

## 2. Writing prompt files

- **Self-contained.** The other tools do not see this conversation. Give the worktree path, the goal, the exact files to read, the owned files, the forbidden files, the interfaces they must keep, acceptance criteria, the commands to run and the state-file name.
- **Sized to the tier** (`AGENTS.md` 3.1). Tier S (free tools) gets small, fully specified tasks within the stated limits, with every needed fact written into the prompt so the agent reads at most three files; Tier M (Codex) gets one medium task; keep integration, cross-cutting refactors, visual verification and anything ambiguous for yourself. When in doubt, make a Tier S task smaller or take it yourself.
- **Disjoint ownership.** No file may be owned by two agents in the same round. Shared hot files (`src/renderer/index.html`, `src/renderer/app.js`, `src/main/index.js`, `src/main/preload.js`, `src/main/config.js`, `backend/contracts.d.ts`) are owned by at most one agent per round, or touched only through additive blocks the plan describes.
- **Checkpoints.** Break every task into 2-6 items so a cut-off agent still leaves finished, committed items behind.
- **Prompt caching.** Keep `main` stable while a round runs: do not reformat or mass-rename files mid-round.

## 3. Your own work in a round

Do your own prompt file (`agents/rounds/R<NN>/claude.md`) in your own worktree like any other agent, and write `agents/state/CURRENT_STATE_claude.md`. Merging and verification of the other branches happen when the user asks for the next actions, not while the others are still working.

## 4. Lessons that must not be repeated

- Run the app after every merge: a duplicated global `const` between two renderer scripts once turned the whole home screen black while all tests passed.
- On the Windows dev machine `in-process-gpu` renders a grey fullscreen window; the default is software compositing (`src/main/gpu-flags.js`). Verify with a real screen capture, not `capturePage`.
- Subagents you spawn inside Claude Code count as your own budget: prefer delegating to the external tools through prompt files.
