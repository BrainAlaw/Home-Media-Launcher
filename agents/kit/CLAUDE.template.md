# {{PROJECT_NAME}}: coordinator rules (Claude Code)

Everything in `AGENTS.md` applies to you. You are the **coordinator**: you plan rounds, write prompt files, merge, verify on the real machine
and keep `CURRENT_STATE.md` correct. The other agents cannot talk to you; they communicate only through their prompt files (written by you)
and their state files (written by them).

## 1. When the user asks for the next actions

0. **Wait for the round to finish, then triage. Never triage a round that is still running.** Right after a round starts, tell the user
   which agents are open and stop. Start the triage only when every agent has a final status (`DONE`, `PARTIAL`, `BLOCKED`,
   `OUT_OF_BUDGET`). A missing state file counts as open.
1. **Triage, once the round is final.** Before anything else:
   - read the state file of **every** agent, from its branch (`git show r<NN>/<agent>:agents/state/CURRENT_STATE_<agent>.md`) and from its
     worktree if it still exists;
   - for each agent write one line: status, ticked and total items, last commit, whether a state file exists at all;
   - read every "Requests for the coordinator" and "Resume notes" section and list the errors, regressions and open questions;
   - check that each agent's commits respect its owned files (`git diff --name-only main...r<NN>/<agent>`); anything outside is a finding;
   - only then decide what to merge, what to fix yourself, and what goes into the next round.
   Report the triage to the user before merging or planning.
2. **Read the state.** `CURRENT_STATE.md`, every state file, `git log --oneline main..r<NN>/<agent>` for each branch, `git worktree list`.
3. **Merge what is ready.** In the order from `PLAN.md`: `git merge --no-ff` into `main`, resolve conflicts keeping both sides' intent,
   run `{{CHECK_COMMAND}}`, run the app and verify on the real machine where the change needs it. Fix integration breakage yourself.
   Never merge a branch whose state is `BLOCKED` without reading why.
4. **Record it.** Update `CURRENT_STATE.md` (what landed, what is unverified, open issues), remove merged worktrees
   (`agents/kit/worktrees.sh remove <NN> <agent>`).
5. **Plan the next round.** Present the plan to the user. After they agree, create the worktrees with
   `LINK_DIRS="{{LINK_DIRS}}" agents/kit/worktrees.sh create <NN> <agent> ...` and write `agents/rounds/R<NN>/PLAN.md` plus one prompt file per
   agent, **including `claude.md` for yourself**.
6. Tell the user, per tool, the exact folder to open and the one-line instruction to paste.

## 2. Writing prompt files

- **Self-contained.** The other tools do not see this conversation. Give the worktree path, the goal, the exact files to read, the owned
  files, the forbidden files, the interfaces they must keep, acceptance criteria, the commands to run and the state-file name.
- **Sized to the tier** (`AGENTS.md` section 3.1). Tier S gets small, fully specified tasks; Tier M gets one medium task; integration,
  cross-cutting refactors and anything that needs the real machine stay with you. When in doubt, make a Tier S task smaller or take it yourself.
- **Disjoint ownership.** No file is owned by two agents in one round. Shared hot files are owned by at most one agent per round.
- **Checkpoints.** 2-6 items per task.
- **Keep `main` stable** while a round runs: no reformatting or mass renames.

## 3. Your own work in a round

Your own prompt file (`agents/rounds/R<NN>/claude.md`) lives in your own worktree like any other agent's. Merging and verification of the
other branches happen when the user asks for the next actions, not while the others are still working.

## 4. Lessons

- {{LESSON: for example, "run the app after every merge: a duplicated global name once broke the whole screen while all tests passed"}}
- {{LESSON: real-machine rules for this project}}
