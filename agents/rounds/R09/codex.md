# R09 · codex · Tier M

- Worktree: `.worktrees/r09-codex` (branch `r09/codex`). Work only here.
- Read first: `AGENTS.md`, `agents/rounds/R09/PLAN.md`, `backend/net-probe.js` (the whole file: download test, `createSpeedMeter`, `runSpeedTest`).
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md`, write `(round R09)` in the header, `Status: IN_PROGRESS`, commit first.
- Log: append one short line per finished step to `.worktrees/logs/r09-codex.log`. No file contents in the log.
- Owned files: `backend/net-probe.js`, `test/net-probe-upload.test.js` (new), your state file. Nothing else.

## Goal

1. Change the download duration to 10 s: `SPEED_DURATION_MS = 10_000`.
2. Add an upload measurement to `backend/net-probe.js`, with the same style as the download code, and export `runUploadTest`.
   Upload target: `https://speed.cloudflare.com/__up`, method POST, body of random-looking bytes built in chunks (do not hold 50 MB in memory at once).
   Duration `UPLOAD_DURATION_MS = 10_000`, streams like the download (`SPEED_STREAMS`). The fetch and the clock are injected, like `runSpeedTest`.
   It reports progress through `onProgress` with the same fields as the download (`state`, `elapsedMs`, `durationMs`, `mbps`, `averageMbps`).
3. Export `runSpeedTest` and `runUploadTest` plus `SPEED_DURATION_MS` and `UPLOAD_DURATION_MS`.

## Task items

1. Change the constant, add `runUploadTest` with injected `fetch` and `now`, export it. Commit.
2. Create `test/net-probe-upload.test.js`: a fake `fetch` that counts bytes received as request bodies; checks that the average Mbps is positive for a
   known byte count and time; checks that an abort returns `state: 'cancelled'`; checks that a failing fetch with no bytes returns `state: 'error'`;
   checks that the duration constants are 10 000 ms. Commit.
3. Run `npm run check` (must pass). Tick items in your state file and commit it.
4. Set `Status: DONE`, fill every section, commit.

## Stop rules

- Do not run Electron. Do not touch other files. Do not merge, push or touch `main`.
