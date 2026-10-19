# {{PROJECT_NAME}}: rules for every AI agent

Read this file completely before you touch anything, then read the prompt file you were given.

## 1. The project

{{ONE_PARAGRAPH_DESCRIPTION}}

- Stack: {{STACK}}
- Check command (must pass before every commit): `{{CHECK_COMMAND}}`
- Test command: `{{TEST_COMMAND}}`
- Run command: `{{RUN_COMMAND}}`

## 2. Universal coding rules

- {{RULE: language of code and commit messages, for example English only}}
- {{RULE: no stubs, no placeholders, no TODO-only code}}
- {{RULE: no new dependencies unless the prompt allows it}}
- {{RULE: secrets never read, printed, copied or committed by worker agents}}
- {{RULE: anything project-specific that every change must respect}}

## 3. How multi-agent work is organised

Several agents work **at the same time**, each in its **own git worktree and branch**, on a **disjoint set of files**. The coordinator
is {{COORDINATOR_TOOL}}.

### 3.1 Roster

| Agent id | Tool | Budget | Typical work |
|---|---|---|---|
| `{{AGENT}}` | {{TOOL}} | large / medium / small | {{TYPICAL_WORK}} |

Tiers:

| Tier | Size limits | What the prompt must contain |
|---|---|---|
| **S** (small) | at most 2-3 files, about 150 changed lines, one module, 2-4 items; no runtime checks | every fact inline, at most three files to read, exact test command and expected result |
| **M** (medium) | one subsystem, up to about 6 files and 500 lines, 3-6 items | goal, interfaces to keep, files to read, acceptance criteria |
| **L** (large) | cross-cutting work, integration, anything that needs the running app | as needed |

If a Tier S agent finds the task bigger than its prompt, it stops: `Status: BLOCKED`, and the reason goes under "Requests for the coordinator".

### 3.2 Files and folders

```
AGENTS.md, CLAUDE.md
CURRENT_STATE.md                       project state (coordinator)
agents/
  STATE_TEMPLATE.md
  state/CURRENT_STATE_<agent>.md       the agent's own report
  rounds/R<NN>/PLAN.md                 round plan
  rounds/R<NN>/<agent>.md              prompt for one agent
.worktrees/r<NN>-<agent>/              worktree of one agent (git-ignored), branch r<NN>/<agent>
```

Worktrees live in `.worktrees/` inside the repository. The coordinator creates them with `agents/kit/scripts/worktrees.sh create <NN> <agent>`.

### 3.3 What every agent must do

1. Open **your own worktree** (path in your prompt). Never edit the main checkout or another agent's worktree.
2. Read this file, your prompt file and anything it tells you to read. Nothing else is required context.
3. **Create your state file first**: copy `agents/STATE_TEMPLATE.md` to `agents/state/CURRENT_STATE_<agent>.md`, set `Status: IN_PROGRESS`,
   list your items as unchecked, commit it.
4. Edit **only the files your prompt marks as owned**. A change elsewhere is not made: write it under "Requests for the coordinator".
5. Work in small steps. After every finished item: run the check command, commit (English message), tick the item in your state file,
   commit that too. The branch must always be in a working state.
6. Finish with `Status:` set to `DONE`, `PARTIAL`, `BLOCKED` or `OUT_OF_BUDGET`, every section of the state file filled in, committed.
   Do not merge into `main`, do not push `main`, do not rebase other branches.

### 3.4 Running out of budget

- Commit after every item, so finished work is never lost.
- If the tool warns that a limit is close, stop at the next clean point: commit, set `Status: OUT_OF_BUDGET`, and write under
  "Resume notes" exactly what the next agent must do (file, function, remaining steps).
- A state file still saying `IN_PROGRESS` means "stopped at the last ticked item".

## 4. Coordinator duties

See `CLAUDE.md`.
