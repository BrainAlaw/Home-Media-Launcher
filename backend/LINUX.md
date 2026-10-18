# Linux setup

Home Media Launcher supports Arch and CachyOS, Debian and Ubuntu, and Fedora. Sign in to the desktop as the single user who will run the launcher; do not run bootstrap as root. The scripts do not install Soloist or create a `.env` file.

## Fresh install

1. Clone the repository and enter its directory.
2. Run `bash scripts/bootstrap.sh`. This installs missing Node.js/npm and Flatpak with the distribution package manager, installs Moonlight from Flathub if needed, and runs `npm ci`.
3. Run `bash scripts/linux/check-soloist.sh`. Install Soloist yourself using the instructions in [SOLOIST.md](SOLOIST.md); this diagnostic only reports its PATH, version, and architecture mapping.
4. Run `bash scripts/linux/setup-permissions.sh` for the Guide-button watcher and xone udev rule. Add `--networkmanager` if you want the optional polkit rule to let the active local user modify their own NetworkManager connections.
5. Run `bash scripts/linux/install-autostart.sh` to start the launcher at desktop login. Use `--desktop-entry` if you prefer XDG autostart over a systemd user unit.

Bootstrap can perform the optional steps with `--with-permissions` and/or `--with-autostart`. These options are opt-in and do not change the default bootstrap behaviour.

## Script effects and undo

- `install-autostart.sh` writes `~/.config/systemd/user/home-media-launcher.service`, enables it for `graphical-session.target`, and runs `npm start` in this checkout; `--desktop-entry` writes `~/.config/autostart/home-media-launcher.desktop` instead. `--uninstall` removes the selected entry and disables the selected unit. `--dry-run` prints intended actions.
- `setup-permissions.sh` adds the current user to `input`, installs `/etc/udev/rules.d/70-vibepollo-xone.rules`, reloads and triggers udev. `--networkmanager` also installs `/etc/polkit-1/rules.d/49-home-media-launcher-networkmanager.rules`, allowing active local users to modify their own connections. These system changes use sudo as needed. To undo, remove those two files, run `sudo gpasswd -d "$USER" input` if the group membership was added solely for this launcher, then log out and back in. Reload rules with `sudo udevadm control --reload-rules && sudo udevadm trigger`.
- `check-soloist.sh` is read-only and never downloads software.
- `bootstrap.sh --with-*` invokes only the selected optional scripts; package installation and `npm ci` still happen as usual.

All scripts support `--dry-run` where applicable. For autostart removal, pass `--uninstall` and the same `--desktop-entry` choice used during installation.

## Wayland and X11

The Guide-button watcher reads `/dev/input/event*`; the `input` group grants access where logind `uaccess` does not. On Wayland, clients cannot force the always-on-top close overlay, so holding Guide closes the running application directly and shows a toast when the launcher returns. Under X11, the overlay may be shown when the window manager honours always-on-top. See [SESSION.md](SESSION.md) for compositor and controller limits.
