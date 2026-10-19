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

The web panel itself arrives in the next round.
