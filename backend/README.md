# Vibepollo backend contract

Theme storage, typed IPC, streaming media and contextual artwork contracts are documented in [THEMING.md](THEMING.md).

Menu schemas, RAM slideshow prefetch, navigation hints and independent status indicators are documented in [MENU-PERFORMANCE.md](MENU-PERFORMANCE.md).

Run `bash scripts/bootstrap.sh` on Linux or `pwsh -File scripts/bootstrap.ps1` on Windows. The scripts install missing dependencies through the OS package manager, install Moonlight (Flatpak on Linux, winget on Windows), then run `npm ci`. Run Linux bootstrap as the desktop user, with sudo available for system packages. Node.js 22 or newer is required. Pair Moonlight with the host once using the Moonlight UI; pairing is deliberately not bypassed. Linux desktop runtime libraries required by Electron must also be supplied by the desktop distribution.

## Remote applications

Existing `settings.remote` fields remain supported. Without API credentials, both platforms use the paired Moonlight client's `list HOST --csv`. Standard Windows installation paths and Linux Flatpak installations are detected automatically. A custom executable can be configured using `moonlightPath`; `moonlightArgs` supplies an argument prefix (for wrappers), and `streamArgs` supplies stream options such as `["--display-mode", "fullscreen"]`.

Set `apiUrl` to an HTTPS server base URL to sync `/api/apps`. `launcher.saveRemoteToken(token)` retains the existing bearer-token contract. For stock Sunshine, call `launcher.saveRemoteCredentials({ type: 'basic', username, password })` instead. Pass `null` to clear credentials. Credentials are encrypted using Electron safeStorage; plaintext fallback key stores are rejected. No credentials are returned to the renderer. Self-signed TLS is opt-in with `allowSelfSigned: true`, scoped to the configured API and artwork at the same origin. Credentials are never forwarded to artwork on another origin. Redirects are rejected.

Sunshine's admin API exposes host-side `image-path` values; these paths cannot be read on a different computer. When API artwork is missing, the backend queries the paired Moonlight client's CSV boxart paths and matches by application name. This step is optional: API metadata remains available if the client is not paired. Explicit icon/cover URLs supplied by a compatible API and custom overrides are also supported. The launcher syncs applications exposed by the host, including Playnite-exported applications; it does not install or configure a Playnite export plugin on the host.

`remote-apps.json` stores the last successful metadata snapshot. Raster artwork is copied into the content-addressed `artwork/` directory under Electron userData. Four workers fetch artwork with bounded response sizes and deadlines. Unchanged icons are reused for one day; image download failures retain previous artwork. Metadata writes are atomic, and disk write failures do not mark an online host offline. Offline snapshots are isolated by host and API endpoint; launch commands are rebuilt from current local settings. Old artwork is retained to preserve custom overrides and offline images; cache size grows with distinct images.

Startup reads the cached remote snapshot without waiting for the network, then refreshes the host in the background. The host monitor subsequently polls every 30 seconds without overlapping polls. `getModel()` and `refreshRemote()` retain their existing contracts. New subscriptions return unsubscribe callbacks:

- `launcher.onRemoteStatus(callback)`: `{ status, host, message, error, warning, updatedAt }`. Status remains `disabled`, `online`, `cached`, or `offline`. For offline states, `message` is `HOSTNAME offline`.
- `launcher.onModelUpdated(callback)`: full updated model after background host sync.
- `launcher.setIconOverride(tileId, source)`: copies a local absolute path, file URL, HTTP(S) URL, or base64 image data URL to managed storage. Returns the rebuilt model. Pass an empty source to remove the override. Applies to custom apps, discovered apps, remote apps and websites, including unselected discovered apps.
- `launcher.chooseFile('icon')`: native image picker.

Frontend integration: subscribe to model updates to render newly synced apps and host status after background polling, and use remote status `message` for the hostname banner. These subscriptions must be connected by the frontend owner; otherwise the existing renderer receives updates only when it explicitly fetches or refreshes its model. Configuration and encrypted credentials persist separately from cached host metadata. Custom overrides are stored in `icon-overrides.json` independently of settings saved by the existing UI. Stable explicit IDs are recommended for custom apps and websites.

## Launching

Native tiles use `command`, string-array `args`, optional absolute `cwd`, and string-valued `env`. No shell is used unless a native tile explicitly opts in with `shell: true`. The inherited `ELECTRON_RUN_AS_NODE` variable is removed from child processes. Missing executables and nonzero exits produce the existing process completion notification and restore the launcher.

Website tiles continue using the sandboxed fullscreen Electron web window. For an external browser, use a custom application tile:

```json
{
  "id": "custom:video-browser",
  "name": "Video",
  "type": "browser",
  "browserEngine": "chromium",
  "command": "/usr/bin/chromium",
  "args": ["--user-data-dir=/home/user/.config/vibepollo-browser"],
  "url": "https://example.com/tv"
}
```

`browserEngine` supports `chromium` and `firefox`; kiosk flags and the validated HTTP(S) URL are appended without shell interpolation. Use a dedicated browser profile so an existing browser process does not take ownership of the window. All privileged launcher IPC handlers accept only the launcher's main frame; web windows cannot invoke those handlers.

## Verification

Run `npm run check` for regression tests and `node scripts/verify-backend.cjs` in a desktop session for the real Electron main-process/preload IPC smoke check. Bootstrap tests use mocked package managers; they never install system packages during tests. A real Linux desktop, Windows package installation, paired Moonlight host, and actual stream remain environment-dependent integration checks.

## Xbox controller pairing

`src/main/controller-pairing.js` retains parsing and the `ControllerPairing` entry point. `controller-session.js` owns commands, cancellation, discovery and events; `controller-hardware.js` owns Linux sysfs detection and battery association. Renderer files are not part of this change. Every command uses argument arrays, a bounded timeout/output buffer, cancellation and an English child locale. There is no shell or automatic privilege escalation.

All methods are exposed through `window.launcher`; their types live in [contracts.d.ts](contracts.d.ts):

| Method | Result |
| --- | --- |
| `getControllerStatus()`, `getConnectedGamepads()` | `{ platform, supported, message, controllers, code? }` |
| `startControllerPairing('bluetooth'|'dongle'|'usb')` | `{ state, transport, devices, message, code? }`; returns after setup, not after the discovery timeout |
| `pairController(id)` | `{ success, message, code?, controller? }` |
| `cancelControllerPairing()` | `{ cancelled }`; stops discovery, in-flight pairing commands and dongle pairing |
| `getDongleStatus()` | `{ present, driver: 'xone'|'xpadneo'|null, pairingSupported }` |
| `startDonglePairing()` | Alias for `startControllerPairing('dongle')` |
| `unblockBluetooth()` | Explicit recovery only: `{ success, message, code? }` |

A controller is `{ id, name, transport: 'bluetooth'|'dongle'|'usb', battery: number|null, charging: boolean }`. The legacy `connected` flag is retained. Unknown battery percentage is `null`; charging is `false` when the OS does not expose charging state. Windows uses the device/parent Bluetooth battery property; many USB/dongle drivers do not publish it. No battery level is fabricated. Linux associates power supplies by MAC or physical HID/GIP ancestry, and falls back to BlueZ battery percentage.

Subscriptions return an unsubscribe function: `onDeviceFound(controller)`, `onPairingSuccess(controller)`, `onPairingError({code,message})`, `onBatteryUpdate({id,battery,charging})`, `onControllersChanged(controllers)`. `onControllerPairingUpdate` remains available with `scanning`, `complete`, `error` and legacy `cancelled` states. Dedicated channels use the `launcher:controller-` prefix, followed by `device-found`, `pairing-success`, `pairing-error`, `battery-update` or `controllers-changed`. The original aggregate channel is unchanged. Consumers subscribing to both formats should deduplicate the same logical discovery/success. Bluetooth discovery reports only unpaired Xbox devices; initial dongle/USB results never list already-connected controllers as discoverable. Completion events carry only newly verified connections.

Errors always include an English message and a stable code: `BLUETOOTH_UNAVAILABLE`, `BLUETOOTH_SOFT_BLOCKED`, `BLUETOOTH_HARD_BLOCKED`, `ADAPTER_NOT_FOUND`, `ADAPTER_POWERED_OFF`, `PERMISSION_DENIED`, `DONGLE_NOT_FOUND`, `DRIVER_MISSING`, `DONGLE_PAIRING_UNSUPPORTED`, `SCAN_TIMEOUT`, `PAIR_FAILED`, `TRUST_FAILED`, `CONNECT_FAILED`, `CANCELLED`, `UNSUPPORTED_PLATFORM`, `UNKNOWN`. A second concurrent start returns `UNKNOWN` with an explicit busy message without disturbing the existing operation. Invalid arguments return structured errors rather than leaking command failures through IPC.

Linux checks BlueZ availability, rfkill blocks, radio presence and power before starting discovery. Hardware blocks take precedence when both rfkill flags are set. Recovery runs `rfkill unblock bluetooth` and `bluetoothctl power on`; denied permissions remain an actionable error. Bluetooth pairing runs `pair`, `trust`, then `connect`, with independent 60/15/30-second timeouts, followed by verification of all three states. An already-paired response still runs trust and connect.

Windows keeps system Bluetooth settings as its default pairing path, with a baseline of existing controllers and bounded polling for a new connection. It restores/focuses the launcher on success; returning to its window refreshes detection. Missing/disabled radios map to the shared adapter codes. Windows dongle pairing requires the receiver's physical button; software pairing returns `DONGLE_PAIRING_UNSUPPORTED`. USB waits for a new connection. Battery sampling runs at 30 seconds only with a connected controller and a visible, non-minimized window. Explicit status requests still work while hidden. Disconnect/charging/battery events are emitted only on changes; no idle battery timer runs with zero controllers. A later status request or window visibility change restarts detection.

Cancellation, scan timeout (default 120 seconds), unexpected discovery exit, renderer reload, window close and application quit clean up sessions. Shutdown waits for cleanup before exiting. Discovery receives `scan off` and `quit`, termination, a forced-kill fallback, and a separate bounded `scan off` command. Dongle pairing is disabled before a session is released. A receiver unplugged during cleanup is harmless; other write failures are reported.

### Linux wireless receiver and optional permissions

Only `xone` supports the Microsoft wireless dongle; `xpadneo` is Bluetooth-only. The implementation verifies loaded modules and Microsoft USB IDs `045e:02e6`/`045e:02fe`. It discovers bound USB interfaces dynamically and checks that their real paths remain under sysfs. The upstream [xone documentation](https://github.com/dlundqvist/xone#pairing-mode) and [`pairing_store` implementation](https://github.com/dlundqvist/xone/blob/master/transport/dongle.c) confirm the per-interface `pairing` attribute accepts `1` to enable and `0` to disable. The driver also has its own bounded pairing timeout. Missing attributes produce an unsupported result rather than an assumed path. Success requires a new input controller beneath the selected receiver interface, not a successful write.

This Windows development machine has no installed Linux xone driver to inspect; the interface was verified against upstream source and fake sysfs, not installed hardware. Drivers are never installed by the launcher. See the upstream installation documentation when `DRIVER_MISSING` is returned.

For an opt-in system permission grant, an administrator may install [70-vibepollo-xone.rules](../scripts/70-vibepollo-xone.rules). Review the rule first. It only grants the `vibepollo-controllers` group write access to the verified pairing attribute, not other receiver controls. On systems with `/usr/bin/chgrp` and `/usr/bin/chmod`:

```bash
sudo groupadd -f vibepollo-controllers
sudo usermod -aG vibepollo-controllers "$USER"
sudo install -m 0644 scripts/70-vibepollo-xone.rules /etc/udev/rules.d/70-vibepollo-xone.rules
sudo udevadm control --reload-rules
```

Sign out/in and reconnect the receiver so permissions apply. These are manual administrator actions, never runtime launcher operations. To revoke access, remove the rule and group membership, reload udev and reconnect the receiver. Keep using the physical Pair button if group access is unsuitable.

### Manual hardware checklist (not verified in CI)

- Linux/BlueZ: missing service/radio, soft/hard block and powered-off diagnostics; explicit recovery including denied access.
- Xbox Bluetooth: discovery filtering, pair/trust/connect, reboot reconnection, cancel/timeout/reload/quit during each operation; confirm no discovery process remains.
- Linux/xone: both Microsoft adapter revisions, loaded driver/firmware, missing pairing attribute, permission denial and opt-in udev permissions; Pair button on controller, new input ancestry, timeout/cancel/quit disabling pairing.
- Linux batteries: xpadneo, xone and BlueZ percentage/charging; two simultaneous controllers must not share another controller's battery.
- Windows 11: missing/disabled radio, system Settings fallback, Alt-Tab/return/restore, new-controller focus restoration, USB and physical dongle pairing.
- Windows battery property availability for the actual controller/driver; missing data must remain `null`/`false`.
- Connected/disconnected and visible/hidden/minimized cases: verify only changed battery values trigger events, and no battery polling continues with zero controllers.

Automated tests fake commands, child processes and temporary sysfs. They require no controller, Linux root, Bluetooth radio or driver installation.
