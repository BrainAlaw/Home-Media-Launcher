# R05 · codex · Tier M

- Worktree: `D:\Github Repos\hml-r05-codex` (branch `r05/codex`). Work only here.
- Read first: `AGENTS.md`, `PLAN.md` in this folder (rules section), `backend/settings-descriptor.js` (the source of every field),
  `backend/ADMIN.md` (the API), `src/main/admin/routes.js` (the routes you call).
- State file: `agents/state/CURRENT_STATE_codex.md`. Copy `agents/STATE_TEMPLATE.md`, set `Status: IN_PROGRESS`, commit before code.
- Owned files: the list in `PLAN.md`. Do not edit `src/main/admin/routes.js` or `src/main/index.js` (the coordinator wires routes).
- Do not read or print `.env` or token files. Do not run `npm install`. No external resources in the page.

## Tasks

1. `src/main/admin/panel/form-model.js` (pure, UMD like `launch-loading.js`):
   - `fieldsFor(descriptor, groupKey)` returns the fields of one page, in descriptor order.
   - `valueAt(settings, path)` and `withValue(settings, path, value)` (immutable update of a dotted path).
   - `validateField(entry, value)` for the client side hints only (boolean, text, number range, enum option). The server stays the judge.
   - `changedPaths(before, after)` lists the paths a save will change, so the page sends only real changes.
   - `test/admin-panel-model.test.js`: every function, including: `object` entries are returned with `readOnly: true`; an enum with an
     unknown value is reported; `withValue` never mutates its input.
2. `src/main/admin/panel/index.html`, `panel.js`, `panel.css`:
   - One page per group from `GROUPS`, a navigation list, and a form built from `fieldsFor`. Input types: checkbox (`boolean`),
     text input (`text`), number input with min and max from the descriptor where given (`number`), select (`enum`), and a read-only
     `<pre>` block for `object`.
   - Load with `GET /api/config`. Save with `PUT /api/config` sending `{ settings: <full settings with changes> }`, header
     `X-HML-Request: 1`, `Content-Type: application/json`. On 422 show the server's message next to the form.
   - Login: if `GET /api/session` says not authenticated, show a code form that posts to `POST /api/pair`.
   - Layout: single column under 720 px with 16 px side margins; two columns above; no horizontal scroll; visible focus; labels on
     every control; `prefers-reduced-motion` respected.
   - The page is generated from the descriptor at load time: it fetches `GET /api/settings-description` (the coordinator adds this
     route from `backend/settings-descriptor.js`). Until then, the page reads a `<script type="application/json">` block the build
     inlines: write the code so that both sources work (descriptor passed in as a parameter of the page function).
3. Report to the coordinator under "Requests for the coordinator": the route `GET /api/settings-description` (returns `GROUPS`,
   `SETTINGS`, `INTERNAL_PATHS`, no secrets), and any field that could not be generated.
4. `npm test` passes, commit, `Status: DONE` in your state file, list every changed file.

Do not merge, do not push, do not touch `main`.
