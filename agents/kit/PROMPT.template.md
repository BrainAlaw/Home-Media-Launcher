# R{{NN}} · {{AGENT}} · Tier {{S|M|L}}

- Worktree: `.worktrees/r{{NN}}-{{AGENT}}` (branch `r{{NN}}/{{AGENT}}`). Work only here.
- Read first ({{at most three files for Tier S}}): `AGENTS.md`, {{FILES}}.
- State file: `agents/state/CURRENT_STATE_{{AGENT}}.md`. Copy `agents/STATE_TEMPLATE.md`, set `Status: IN_PROGRESS`, commit before code.
- Owned files: {{OWNED_FILES}}. Your state file. Nothing else.
- Forbidden: {{FORBIDDEN_FILES}}, `main`.

## Goal

{{WHAT_AND_WHY, two to four sentences}}.

## Interfaces to keep

- {{EXACT_FUNCTION_OR_ROUTE_SIGNATURE_AND_SHAPE}}

## Task items

1. {{ITEM: one concrete change in the owned files, with the expected behaviour}}.
2. {{ITEM}}.
3. {{ITEM: tests, with the names of the cases that must exist}}.
4. Run `{{TEST_COMMAND}}` (must pass), then `{{CHECK_COMMAND}}` (must pass). Commit after each item with an English message. Tick the item and
   commit the state file.
5. Set `Status: DONE` in your state file, fill every section, commit. In "Requests for the coordinator" list anything outside your files.

## Acceptance

- {{MEASURABLE_CRITERION}}

## Stop rules

- Stop (`Status: BLOCKED`) if the work grows past {{LIMIT}} or needs a file you do not own.
- {{TOOL_LIMITS: for example, "do not run the app" for agents without a display}}.
- Do not merge, do not push, do not touch `main`.
