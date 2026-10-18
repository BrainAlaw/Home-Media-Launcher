# R01 · codex · Tier M

- Worktree: `D:\Github Repos\hml-codex` (branch `r01/codex`). Work only here.
- State file: `agents/state/CURRENT_STATE_codex.md` (copy `agents/STATE_TEMPLATE.md`, create it **before** writing code, commit it).
- Owned files: `scripts/bootstrap.sh`, `scripts/linux/**` (new), `backend/LINUX.md` (new), `test/linux-scripts.test.js` (new), your state file. Read-only: everything else.

## Goal

Make a fresh Linux HTPC (Arch/CachyOS first, also Debian/Ubuntu and Fedora) ready to run the launcher at login with one idempotent command, and document it. The machine is a single-user living-room PC that boots into the user's desktop session.

## Read first

`scripts/bootstrap.sh` (already installs Node, npm, Flatpak and Moonlight), `scripts/70-vibepollo-xone.rules` (udev rule for the Xbox wireless dongle), `backend/VPN.md` (the NetworkManager polkit rule section), `backend/SOLOIST.md` (Soloist is installed by the user; the launcher must not download it), `backend/SESSION.md` (the Guide-button watcher reads `/dev/input/event*`).

## Tasks (commit after each, tick it in your state file)

1. `scripts/linux/install-autostart.sh`: installs a systemd **user** unit `home-media-launcher.service` (runs `npm start` in the project folder after `graphical-session.target`, restarts on failure, `ELECTRON_RUN_AS_NODE` unset) or, with `--desktop-entry`, an XDG autostart `.desktop` file instead. Supports `--uninstall` and `--dry-run`.
2. `scripts/linux/setup-permissions.sh`: adds the user to the `input` group (needed for the Guide watcher), installs the udev rule from `scripts/70-vibepollo-xone.rules`, optionally (`--networkmanager`) installs the polkit rule from `backend/VPN.md`. Uses `sudo` only for the steps that need it, prints what it changes, supports `--dry-run`, is safe to run twice.
3. `scripts/linux/check-soloist.sh`: reports whether `soloist` is on PATH, its `--version`, and the CPU architecture mapping from `backend/SOLOIST.md`; never downloads anything.
4. Extend `scripts/bootstrap.sh` with an opt-in `--with-autostart` / `--with-permissions` flag that calls the scripts above. Keep its current behaviour unchanged when no flag is given.
5. `test/linux-scripts.test.js` (`node:test`): if `bash` is available, run `bash -n` on every script and the `--dry-run` path of each script with a temporary `HOME`; skip cleanly (with `t.skip`) when `bash` is missing.
6. `backend/LINUX.md` (UK spelling): fresh-install steps, what each script changes, how to undo it, Wayland vs X11 notes from `backend/SESSION.md`.

Rules: `set -Eeuo pipefail`, quote every variable, no `curl | sh`, no secrets in any file, never touch `.env`. Finish with `Status: DONE` (or `PARTIAL` with resume notes).
