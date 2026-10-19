# Round R{{NN}}: {{ROUND_TITLE}}

Goal: {{ONE_OR_TWO_SENTENCES: what the user can do or see after this round}}.

Base: `main` ({{BASE_DESCRIPTION, for example "after R05, merge <hash>"}}).

## Scope

1. **{{ITEM}}**: {{WHAT, WHERE, ACCEPTANCE}}.
2. **{{ITEM}}**: {{WHAT, WHERE, ACCEPTANCE}}.

## Owners

| Agent | Tier | Worktree | Branch | Task |
|---|---|---|---|---|
| `{{AGENT}}` | S / M / L | `.worktrees/r{{NN}}-{{AGENT}}` | `r{{NN}}/{{AGENT}}` | {{ONE_LINE_TASK}} |

Each free-tool task is fully specified in its prompt file and does not depend on another agent's output.

## Ownership map

| File | Owner | Others |
|---|---|---|
| `{{PATH}}` | `{{AGENT}}` | none |

Shared hot files ({{LIST}}) are touched by one agent only, or through the additive blocks described here.

## Rules

- {{ROUND_SPECIFIC_RULE}}

## Merge order

1. {{AGENT}}: {{WHY_FIRST}}
2. {{AGENT}}
3. Coordinator: {{VERIFICATION_ON_THE_REAL_MACHINE}}, then the user decides.

## What the user does

| Tool | Folder | Paste |
|---|---|---|
| {{TOOL}} | `.worktrees/r{{NN}}-{{AGENT}}` | `Read AGENTS.md and agents/rounds/R{{NN}}/{{AGENT}}.md, then follow the prompt.` |
