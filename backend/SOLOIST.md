# Spotify Soloist (headless Spotify Connect device, Linux only)

Soloist is Spotify's headless Spotify Connect client. The launcher starts it as a child process so that a Linux HTPC appears
as a playback device in the Spotify app. Implementation: `backend/soloist/process.js` (supervisor), `backend/soloist/paths.js`
(default directories and binary name).

Soloist is **not redistributable**. The launcher does not bundle it and does not download it. You install it yourself.

## Requirements

- Linux on x86_64, aarch64 or armv7. Windows and macOS are **not supported** by Soloist; the launcher reports `unsupported`.
- PipeWire or PulseAudio.
- A Spotify Premium account and a Soloist API key (see below).

## 1. Install Soloist (Linux)

1. Check your architecture:

   ```sh
   uname -m
   ```

   | `uname -m` output | Build to download |
   | --- | --- |
   | `x86_64` | x86_64 |
   | `aarch64` | aarch64 |
   | `armv7l` | armv7 |

2. Download the build for your architecture with the `curl` command shown on the Soloist documentation page. Downloads come
   from `soloist-builds.spotifycdn.com`. Use the command from Spotify's page, because the file name changes between releases.
3. Install the binary to a directory on `PATH`:

   ```sh
   sudo install -m 755 soloist /usr/local/bin/soloist
   ```

4. Verify the installation:

   ```sh
   soloist --version
   ```

   If the command is not found, either fix `PATH` or set the full path in the launcher settings (`soloist.binaryPath`).
   The launcher looks for `soloist` on `PATH` when no path is configured.

## 2. Create a Soloist API key

1. Open the Spotify for Developers dashboard: https://developer.spotify.com/dashboard
2. Log in with the Spotify account you want to use. Accept the developer terms when prompted; the Soloist API key page is
   unavailable until you have done so.
3. Open the **Soloist API Key** page and create a key.
4. Copy the key. Treat it like a password.

## 3. Put the key in `.env`

Add the key to the `.env` file in the launcher folder (the file is git-ignored):

```dotenv
SPOTIFY_SOLOIST_API=your_soloist_api_key
```

The key is read in the main process only. It is never sent to the renderer, never written to logs, and the launcher redacts it
from any Soloist output it records. Restart the launcher after changing `.env`.

## 4. Pair the device

1. Start the launcher. It starts Soloist with the device name from the settings.
2. Open the Spotify app (phone or desktop) on the same network.
3. Open the device picker (Connect) and choose the device name you configured. Playback can now be transferred to it.
4. Pairing is stored in the Soloist data directory (`~/.local/share/soloist` by default, or `$XDG_DATA_HOME/soloist`). Keep
   that directory between restarts so you do not have to pair again.

## 5. Expiry

Every Soloist build expires **90 days after its build date**. When it expires, Soloist exits with code 10 and the launcher shows
`Soloist build expired - download a newer build`. The launcher does not restart an expired build.

To renew: download the newest build (section 1), replace `/usr/local/bin/soloist`, and restart the launcher.

## 6. Behaviour and limits

- Start command (built by the launcher, no shell involved):
  `soloist --device-name "<name>" --api-key "<key>" --data-dir <dir> --cache-dir <dir> --ws 127.0.0.1:<port> [--pipewire-device <node>]`.
- The WebSocket listens on `127.0.0.1` only. The port is chosen by the OS (`--ws 127.0.0.1:0`); Soloist then writes it to
  `ws.port` (or `ws.addr`) in the data directory. The launcher deletes stale files before each start and reads the new port
  for up to 10 s.
- Crashes restart with exponential backoff: 2 s, 4 s, 8 s, 16 s, 32 s, then 60 s. After six restarts in a row the state becomes
  `failed` until you restart the launcher. A run that stays up for 60 s resets the counter.
- Stopping: SIGTERM, then SIGKILL after 5 s. The launcher stops Soloist on quit.
- **Known limitation:** on Linux the API key is passed as a command-line argument (`--api-key`). Any process running as the same
  user can read it from `/proc/<pid>/cmdline` while Soloist runs. The launcher follows the documented argv form, so keep the HTPC single-user or accept this exposure.
- Soloist requires PipeWire or PulseAudio. Without a working audio server it fails to start.
- One Soloist instance per launcher. The launcher does not manage multiple devices.
- Not yet tested on a real Linux machine; the process supervisor is covered by unit tests with fake processes.
