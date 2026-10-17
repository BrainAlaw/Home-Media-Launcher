# Spotify integration (ns `media`)

Home Media Launcher controls Spotify through the Spotify Web API using Authorization Code with PKCE. No client secret exists
in the app, the only external hosts contacted are `accounts.spotify.com` and `api.spotify.com`, and tokens never reach the
renderer, logs or error messages. Implementation: `src/main/ext/media.js` (IPC), `backend/spotify/` (auth, client, service).

## Verified rules (checked October 2026)

Sources:
- Redirect URIs: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- PKCE flow: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- Refreshing tokens: https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens
- Rate limits: https://developer.spotify.com/documentation/web-api/concepts/rate-limits
- Development Mode changes: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- Reference pages for start playback, playback state, transfer, volume, playlist items, current user's playlists (developer.spotify.com/documentation/web-api/reference/...)

Findings:
- Redirect URI: must match a registered URI exactly. HTTPS is required except loopback; use the IP literal `http://127.0.0.1:<port>/callback`. `localhost` is not allowed. A loopback URI registered without a port may use any port at request time; the launcher instead registers fixed ports (below) so the setup is explicit.
- PKCE: `code_challenge_method=S256`; verifier 43-128 characters (`A-Za-z0-9-._~`). Token request: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`; no client secret. Refresh: `grant_type=refresh_token`, `refresh_token`, `client_id`. The response may omit a new refresh token (keep the old one). `invalid_grant` means expired or revoked: discard and sign in again. Access tokens last 3600 s.
- Development Mode (every new app): the app owner needs an active Spotify Premium subscription; if it lapses the app stops working. New apps are limited to 5 users, who must be added to the app's user management list; others get 403. One Client ID per developer (Spotify raised this to 25 in July 2026). Extended quota is for organisations only, so it is not an option for a personal HTPC.
- Player endpoints (play, pause, next, previous, shuffle, repeat, volume, transfer) work only for Premium users and are unchanged by the February 2026 migration.
- Changes since February 2026 that matter here: `GET /search` has `limit` max 10 (default 5); `GET /playlists/{id}/tracks` was renamed `GET /playlists/{id}/items` (limit max 50, only playlists the user owns or collaborates on, entries expose `item`, deprecated `track` kept); `GET /me/playlists` limit max 50, track count under `items.total` (deprecated `tracks.total`); `GET /me` no longer returns `product`, `country` or `email`, so the Premium status is not shown (the `product` field of `signed-in` is omitted).
- Rate limits: a rolling 30-second window per app. HTTP 429 carries `Retry-After` in seconds.
- Not confirmed on the reference pages: the `NO_ACTIVE_DEVICE` error is not documented on the start playback page. The client matches `reason: NO_ACTIVE_DEVICE` or an HTTP 404 message containing "no active device"; this is the long-standing behaviour but could not be verified without credentials.

Scopes requested: `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`,
`playlist-read-private`, `playlist-read-collaborative`, `user-library-read`.

Endpoints used: `GET /me`, `GET /me/player` (`additional_types=track,episode`), `GET /me/player/devices`, `PUT /me/player` (transfer),
`PUT /me/player/play|pause|volume|shuffle|repeat`, `POST /me/player/next|previous`, `GET /search` (limit 10),
`GET /me/playlists`, `GET /playlists/{id}/items`.

## Setup

1. Sign in at https://developer.spotify.com/dashboard with a **Premium** account and choose Create app.
2. Name it (for example "Home Media Launcher"), tick **Web API**, and add these Redirect URIs (all four, so a busy port never blocks sign-in):
   - `http://127.0.0.1:8888/callback`
   - `http://127.0.0.1:8889/callback`
   - `http://127.0.0.1:8890/callback`
   - `http://127.0.0.1:8891/callback`
3. Open the app's Settings > User management and add the name and Spotify e-mail of every account that will sign in (yourself included; maximum 5).
4. Copy the **Client ID** (there is no need for the client secret) into `.env`: `SPOTIFY_CLIENT_ID=your_client_id`.
5. Restart the launcher, open the media widget and choose Sign in. A browser opens on Spotify's consent page; if it does not, the URL is shown in the widget. After approving, close the tab.
6. Keep Spotify (desktop app, phone or any Connect device) installed: playback needs a device. When none is active the launcher opens the desktop app via `spotify:` and transfers playback within 8 seconds.

## Behaviour

- Loopback listener binds only `127.0.0.1`, tries ports 8888, 8889, 8890, 8891, validates `state`, and closes after the callback or after 5 minutes.
- Tokens are stored encrypted with Electron `safeStorage` in `<userData>/spotify-tokens.json`. If secure storage is unavailable the session lives in memory only.
- Polling (main process): about 1 s while playing and the window is visible, 5 s paused, 15 s idle or hidden, none while signed out or while a launched application owns the screen (`session` phase not `idle`). Failures back off exponentially up to 60 s and a long `Retry-After` pauses polling. The last state is cached in `<userData>/media-state.json` and shown immediately (flagged `stale`, `playing: false`) at start-up.
- Methods resolve `{ ok: false, error, code }` instead of throwing.

## ns `media` API (additive details beyond backend/contracts.d.ts)

- `MediaState` gains optional `stale?: boolean` (last known state; Spotify unreachable or cache not yet refreshed).
- `status()` and `nowPlaying()` return `MediaState`. `login()` returns `{ ok, url?, error? }` (completion arrives as an `auth` event). `logout()` returns `{ ok }`.
- `control`, `setVolume`, `transfer`, `play`, `openSpotifyApp` return `{ ok, error?, code? }`.
- `devices()` returns `{ ok, devices: MediaDevice[] }`; `search()` returns `{ ok, results: MediaSearchResult }`.
- `playlists(offset?)` and `playlistTracks(id, offset?)` return `{ ok, items, total, offset, nextOffset: number | null }` (50 per page).
- Error codes: `UNCONFIGURED`, `AUTH`, `OFFLINE`, `RATE_LIMITED`, `PREMIUM_REQUIRED`, `NO_ACTIVE_DEVICE`, `NO_DEVICE`, `VOLUME_CONTROL_DISALLOW`, `INVALID`, `HTTP_<status>`.

## Soloist (local player, ns `soloist`, Linux only)

Optional local Spotify Connect player. When enabled (`settings.soloist.enabled`) and its socket is live, playback state comes from
the Soloist WebSocket instead of `GET /me/player`, and the Web API is used only for commands and the device hand-off: the Soloist
device (matched by `settings.soloist.deviceName`, default `Home Media Launcher`) is listed in `GET /me/player/devices` and playback
is transferred to it once (`PUT /me/player`, paused unless something was already playing). If the socket drops, the normal Web API
polling resumes. On win32/darwin the feature reports `unsupported` and nothing changes.

- Key: `SPOTIFY_SOLOIST_API` in `.env`, read only by the main process (`readSecrets().soloistApiKey`), handed to the Soloist process
  and removed from the environment; never sent to the renderer, logged or placed in errors (messages are redacted).
- Implementation: `backend/soloist/` (`manager.js` lifecycle and state mapping, `settings.js` validation) and `src/main/ext/soloist.js`.
  `backend/spotify/service.js` receives the manager as its `soloist` option.
- Renderer: quick-settings row `#soloist-row` (`soloist-status.js`), and the media widget line "Soloist: this computer".
