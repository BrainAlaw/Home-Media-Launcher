# Round R10: consistent hover in Quick settings, and a mouse audit of the whole product

Goal: (1) Tailscale and Surfshark rows hover exactly like the other Quick settings rows. (2) A written audit of where the mouse does not work
today, so that mouse mode can be planned from facts. The audit changes no code.

Base: `main` (after `bfa960a`).

## Cause to fix (from R09 analysis)

Static Quick settings rows are registered in `navigation-menu.js` and get inline `transform` from the JS motion. The inline value beats the
CSS `:hover` lift. VPN rows (`createVpnRow` in `status-widgets.js`) are created later and are not registered, so they keep the CSS lift.
Fix: one source of truth for the row hover. The CSS hover rule for `.qs-row` stays; the JS motion must not write `transform` on rows
that the CSS already lifts, or every row must be registered the same way.

## Owners

| Agent | Runs as | Worktree | Branch | Task |
|---|---|---|---|---|
| `claude` | subagent of the coordinator chat (Tier L) | `.worktrees/r10-claude` | `r10/claude` | hover fix in Quick settings |
| `codex` | Codex CLI (Tier M) | `.worktrees/r10-codex` | `r10/codex` | read-only mouse audit, written to `docs/MOUSE-AUDIT.md` |

## Ownership map

| File | Owner |
|---|---|
| `src/renderer/navigation-menu.js`, `src/renderer/status-widgets.js`, `src/renderer/styles.css`, `src/renderer/menu.css`, `src/renderer/status.css` | claude |
| `docs/MOUSE-AUDIT.md` (new) | codex |
| `agents/state/CURRENT_STATE_<agent>.md` | each agent |

## Merge order

1. `codex` (docs only, no conflicts).
2. `claude`. Coordinator checks on the PC that the VPN rows hover like Settings.

Mouse mode itself is NOT part of R10. It comes in R11, after the audit is read and the scope is agreed.
