# Admin panel (LAN)

The launcher can be configured from another device on your home network, for example a phone or a laptop, so you do not
have to connect a keyboard and mouse to the TV.

## Enable it

In `config.json` (or in the future Settings page), under `settings.admin`:

```json
"admin": { "enabled": true, "port": 8787 }
```

- `enabled` is `false` by default. When it is off, nothing listens on the network.
- `port` defaults to 8787 (1024 to 65535).
- `bindAddress` is optional. By default the panel listens only on the first private LAN address (192.168.x.x, 10.x.x.x or
  172.16 to 172.31). Tailscale addresses are not used by default.

## First start on Windows: allow the firewall prompt

The first time the panel listens, Windows Firewall asks whether Electron may accept connections on private networks.
Choose **Allow** for **private networks**. Without it other devices cannot reach the panel.

## Pair a device

1. Open **Settings > Remote host** on the TV and press **Show admin panel pairing code**.
2. A card appears on the TV with a six-digit code and the address, for example `http://192.168.0.196:8787`.
3. On the other device, open that address and enter the code. The code is valid for five minutes and works once.
4. After pairing, the device keeps a session for twelve hours.

## Security (what is in place)

- Pairing codes are compared in constant time. Five wrong attempts lock pairing for one minute.
- Sessions are random tokens in an `HttpOnly`, `SameSite=Strict` cookie. Only a hash is kept in memory, so restarting the
  launcher signs everyone out.
- Every change needs the `X-HML-Request: 1` header and a matching `Origin`. Requests from other websites are refused.
- Secrets (API keys, tokens) are never returned. The config read shows them as `<set>` or `<unset>`.
- Every write is validated before it is saved. A config that fails validation is not written.
- Plain HTTP on the LAN is accepted as a known risk: anyone on the same network who can see the traffic could read the
  session cookie. Use the panel on a network you trust.

## API (current)

- `GET /api/health`: no login needed.
- `POST /api/pair` with `{ "code": "123456" }`: sets the session cookie.
- `POST /api/logout`, `GET /api/session`.
- `GET /api/config`: login needed, secrets masked.
- `PUT /api/config`: login and the `X-HML-Request` header; validated, then saved.
- `GET /api/settings-description`: no login needed. Returns `{ GROUPS, SETTINGS, INTERNAL_PATHS, ACTIONS }` from
  `backend/settings-descriptor.js` and `backend/actions.js`. It holds no values, so it is safe to show before pairing.
- `GET /api/status`: login needed. One probe per source (`src/main/admin/status.js`), each `{ state: ok | unknown | error, detail }`.
  Every probe has a timeout and a missing source reports `unknown`. No token, key or SSID is returned.
- `GET /api/log?tail=N`: login needed. Returns `{ entries: [{ time, level, message }] }`, the newest `N` lines of the
  launcher console (`src/main/admin/log.js`, 500 lines kept, `N` clamped to 1 to 500, default 100). Messages are redacted on write.
- `GET /api/diagnostics`: login needed. A JSON file (`Content-Disposition: attachment; filename="hml-diagnostics.json"`) with the
  status, the last 500 log lines, the settings with secrets masked, and the names of the secrets with a set/unset flag only.
  Every secret value is replaced with `<redacted>` in the output.
- `GET /api/actions/confirm/<name>`: login needed, destructive actions only (other names 404). Returns `{ token, expiresAt }`.
  The token is single-use and valid 60 seconds; a new request for the same name replaces the earlier token.
- `POST /api/actions/<name>`: login and the `X-HML-Request` header. Unknown name 404. A destructive action needs
  `{ "confirm": "<token>" }`: missing token 428, wrong, used or expired token 403. The handler then runs; a name without a
  registered handler answers 503, a failing handler 500 with a generic message. Success: `{ ok: true, message }`.
  The handlers come from `createAdminRoutes({ actions })` (`backend/actions.js` names them).

## Panel files (`/admin/`)

- `GET /admin/` serves `index.html`; `GET /admin/<file>` serves a flat file from `src/main/admin/panel/`. No login: the page is
  public, the data is not.
- Allowed types: `.html .js .css .json .svg .png`. Anything else, sub-folders, dot files, encoded separators, `..`, drive letters
  and `%` in names give 404. `GET /admin` redirects to `/admin/`. Other methods give 405.
- Responses carry the security headers (`Content-Security-Policy: default-src 'self'`, `nosniff`, `no-referrer`) and
  `Cache-Control: no-cache` so an updated panel is loaded at once.
- The panel has no inline script and no `eval`; its JavaScript and CSS are separate files.

## Object settings in the panel (R05)

`remote`, `vpn`, `wallpaper`, `wallpaperSources`, `soloist`, `backgroundApps`, `header`, `homeHeader`, `categories`, `theme` and
`background` are read-only in the panel for now. Edit them on the TV. Editors come in a later round.
