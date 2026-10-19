# Multi-agent kit

A project-independent way to run several AI coding agents at the same time on one git repository. One coordinator (Claude Code)
plans the work, writes prompt files, merges the branches and verifies the result. The other agents (Codex, GitHub Copilot, Freebuff,
OpenCode, Cursor, or any other tool) work in their own git worktree and branch, on files nobody else owns, and report through a
state file.

Nothing in this folder depends on a language or framework. Adjust the `{{PLACEHOLDERS}}` in the templates to your project.

## What is in the kit

| File | Use |
|---|---|
| `README.md` | this guide |
| `AGENTS.template.md` | the rules every agent reads first (copy to `AGENTS.md`) |
| `CLAUDE.template.md` | the coordinator procedure for Claude Code (copy to `CLAUDE.md`) |
| `PLAN.template.md` | one round plan: goal, owners, file ownership, merge order, what the user does (copy to `agents/rounds/R<NN>/PLAN.md`) |
| `PROMPT.template.md` | one self-contained prompt per agent (copy to `agents/rounds/R<NN>/<agent>.md`) |
| `STATE_TEMPLATE.md` | the state file each agent writes (copy to `agents/STATE_TEMPLATE.md`) |
| `worktrees.sh` | creates and removes the per-agent worktrees; runs in Git Bash on Windows and in any POSIX shell |

## Install in a project

1. Copy this folder to `agents/kit/` in the project.
2. Copy `AGENTS.template.md` to `AGENTS.md` and `CLAUDE.template.md` to `CLAUDE.md`. Fill in every `{{PLACEHOLDER}}`, then delete the
   sections that do not apply. Keep the roster, the tiers, the ownership rules and the state protocol.
3. Copy `STATE_TEMPLATE.md` to `agents/STATE_TEMPLATE.md`.
4. Add the worktree folder to `.gitignore`:
   ```
   # Round worktrees (see AGENTS.md)
   .worktrees/
   ```
5. Optional: set `LINK_DIRS` for folders that each worktree needs and cannot share through git, for example `node_modules`. Worktrees do not
   contain git-ignored folders, so a fresh worktree has no dependencies until you link or install them.
6. Check that `{{CHECK_COMMAND}}` passes on `main` before the first round.

## Layout

```
<project>/
  AGENTS.md                      rules for every agent
  CLAUDE.md                      coordinator procedure
  CURRENT_STATE.md               project state, owned by the coordinator
  agents/
    STATE_TEMPLATE.md
    state/CURRENT_STATE_<agent>.md   one per agent, rewritten by that agent
    rounds/R<NN>/PLAN.md             round plan
    rounds/R<NN>/<agent>.md          prompt per agent
  .worktrees/                    git-ignored; r<NN>-<agent> worktrees live here
```

## One round, step by step

1. **Plan.** The coordinator reads `CURRENT_STATE.md` and the last round's state files, then writes `PLAN.md`: goal, one owner per file,
   tiers, merge order. The user agrees to the plan.
2. **Create.** `LINK_DIRS="node_modules" BASE=main bash agents/kit/worktrees.sh create <NN> <agent> [agent...]`. Each agent gets
   `.worktrees/r<NN>-<agent>` on branch `r<NN>/<agent>`.
3. **Hand out.** The user opens each worktree folder in the agent's tool and pastes one line, for example
   `Read AGENTS.md and agents/rounds/R<NN>/<agent>.md, then follow the prompt.` The coordinator can run its own task in a separate session.
4. **Work.** Each agent commits after every checklist item, ticks it in its state file, and sets its final status to `DONE`, `PARTIAL`,
   `BLOCKED` or `OUT_OF_BUDGET`.
5. **Triage.** When every agent has a final status, the coordinator reads every state file and the branch logs, checks that every
   commit stays inside the owned files, and reports to the user before merging.
6. **Merge.** In the order from `PLAN.md`: `git merge --no-ff r<NN>/<agent>` into `main`, run the check command, fix integration problems.
   Verify what can only be verified on the real machine, and say so in the state file.
7. **Record.** Update `CURRENT_STATE.md`, remove merged worktrees (`worktrees.sh remove <NN> <agent>`), and plan the next round.

## Rules that make it work

- **One owner per file in a round.** Shared hot files (routing tables, the app entry point, the config schema, shared type declarations)
  have one owner, or they change only through additive blocks named in the plan.
- **Tiers match the tools.** Tier S (small, free, weaker models): 2-3 files, about 150 changed lines, one module, every needed fact
  written into the prompt, no runtime checks. Tier M: one subsystem, up to about 6 files. Tier L (the coordinator or the strongest
  agent): cross-cutting work, integration, anything that needs the real machine.
- **Stop instead of improvising.** An agent whose task is bigger than its prompt sets `BLOCKED` and writes the reason under
  "Requests for the coordinator".
- **Checkpoints.** Break every task into 2-6 items, so a cut-off agent leaves finished, committed work behind.
- **No merging by agents.** Agents never merge into `main`, never push `main`, never rebase other branches.
- **Keep `main` stable during a round.** No mass renames or reformatting while agents work.
- **Secrets stay out.** Agents never read or copy credential files; the coordinator decides what a check may read.

## Worktree location

Worktrees live in `.worktrees/` inside the repository, which is git-ignored. Nothing lands next to the project, and one folder holds every
round's work. `node --test` and most test runners do not pick up tests from a nested worktree; check that in your project with the
test command before you rely on it. Do not move a worktree while its agent is working on it.
