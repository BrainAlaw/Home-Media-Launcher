# Troubleshooting

Short fixes for common problems. For full setup steps, see [Getting started](GETTING_STARTED.md) and the linked backend docs.

## Grey or black window on Windows

The launcher uses software compositing by default. Do not set `HML_GPU_PROCESS=inprocess`. Set `HML_GPU_SAFE=1` to turn all GPU switches off.

## `npm start` fails with `registerSchemesAsPrivileged`

If you see:

`TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`

the variable `ELECTRON_RUN_AS_NODE` is set in the terminal (VS Code does this). Unset it and start again.

## Home screen empty after an update

Run `npm run check`. A failing `renderer-globals` test means two renderer scripts declare the same global name.

## Spotify says 403 or "Premium required"

The Spotify account must be Premium and listed under User management in the developer dashboard. Full steps: [backend/SPOTIFY.md](../backend/SPOTIFY.md).

## Soloist stops with "build expired"

Soloist builds expire after 90 days. Download a newer build — see [backend/SOLOIST.md](../backend/SOLOIST.md).

## Weather line says "Set your location in Settings"

No location is set. Enable weather and type a location in **Settings > General > Weather** (for example `London,GB`).

## Surfshark is grey on Windows

Create a Windows VPN profile named `Surfshark`. Details: [backend/VPN.md](../backend/VPN.md).

## Game tiles have no cover art

Add `STEAMDB_API` to your `.env` file (copy from `.env.example` if needed). Never share that file.
