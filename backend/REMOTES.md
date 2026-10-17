# Remote controls (Bluetooth / USB)

Home Media Launcher accepts Amazon Fire TV remotes, Google TV / Chromecast remotes and generic HID or air-mouse
remotes. They appear to the OS as keyboards or consumer-control devices, so no driver or bridge is needed. HDMI-CEC
and IR-only remotes are not supported.

## Key mapping

Implemented in `src/renderer/remote-keymap.js` (pure, unit-tested) and wired by `src/renderer/remote-input.js`.
Remote keys are replayed as canonical keyboard events, so they follow the same path as the keyboard.

| Remote button | DOM key / code | Action |
| --- | --- | --- |
| D-pad | `ArrowUp/Down/Left/Right` | `up/down/left/right` (auto-repeat) |
| Centre / OK | `Enter`, `NumpadEnter`, `Select`, Android 23/66 | `select`; held 500 ms: `context` (long) |
| Back | `Escape`, `BrowserBack`, `GoBack`, `Backspace`, Android 4 | `back` |
| Home | `BrowserHome`, `Home`, `Meta` (tap), Android 3 | `home`; held 500 ms: `home` (long) |
| Menu / Info / options | `ContextMenu`, `Menu`, `F1`, `Info`, Android 82/165 | `menu` |
| Play/Pause/Stop | `MediaPlayPause`, `MediaPlay`, `MediaPause`, Android 85/126/127 | `playpause`, `stop` |
| Next/Previous, FF/Rewind | `MediaTrackNext/Previous`, `MediaFastForward`, `MediaRewind` | `next`, `previous` |
| Channel +/- , Page | `ChannelUp/Down`, `PageUp/Down`, Android 92/93/166/167 | `pageup`, `pagedown` (repeat) |
| Colour keys | `ColorF0Red` ... `ColorF3Blue`, Android 183-186 | `red/green/yellow/blue` |
| Volume / mute / power | `AudioVolume*`, `Power` | passed through to the OS untouched |

Android keycodes are only used when the browser reports `key: "Unidentified"`.

Timing: first repeat after 350 ms, then every 90 ms, accelerating to about 65 ms after 8 repeats and about 45 ms after 20.
`Meta` only counts as Home when tapped alone (Super+key desktop chords are ignored).

## DOM events (for other modules)

* `launcher:remote-action` on `document`: `CustomEvent` (cancelable) with `detail = { action, long, source }`.
  `action` is a contract `RemoteAction` (`up down left right select back home menu playpause context`) or one of
  `pageup pagedown next previous stop red green yellow blue`. A held Select yields `{ action: 'context', long: true }`;
  a held Home yields `{ action: 'home', long: true }` (use it for the close-running-app overlay and call
  `event.preventDefault()`). A Home tap that is not prevented behaves like Back.
* `launcher:input-device` with `detail.device` of `remote | keyboard | gamepad | pointer`; mirrored on
  `document.body.dataset.inputDevice` so CSS can switch hint glyphs, e.g. `body[data-input-device="remote"] .hint-pad { display: none }`.
* Remote key presses hide the mouse cursor (`body.cursor-hidden`).

## Main process: ns `input`

`window.launcher.ext.invoke('input', 'list')` returns `RemoteDevice[]`
(`{ id, name, bus: 'usb' | 'bluetooth' | 'other', address?, handlers[] }`); `ext.on('input', 'devices', cb)` fires on change
(polled every 10 s). Linux only, parsed from `/proc/bus/input/devices` (names matching Remote, Fire TV, Chromecast,
Google TV, Android TV, Air Mouse). Other platforms return an empty list. A Settings page may show this as a hint.

## Pairing on Linux (bluetoothctl)

```
bluetoothctl
[bluetooth]# power on
[bluetooth]# agent on
[bluetooth]# default-agent
[bluetooth]# scan on
   (put the remote in pairing mode, wait for it to appear)
[bluetooth]# pair AA:BB:CC:DD:EE:FF
[bluetooth]# trust AA:BB:CC:DD:EE:FF
[bluetooth]# connect AA:BB:CC:DD:EE:FF
[bluetooth]# scan off
```

`trust` is what makes the remote reconnect automatically after sleep or reboot.

* **Fire TV remote:** hold Home for about 10 seconds until the LED blinks blue, then pair. Newer remotes may need
  Home + Back instead.
* **Google TV / Chromecast remote:** hold Back + Home until the LED blinks white or blue, then pair.

Verify with `bluetoothctl info AA:BB:CC:DD:EE:FF` (`Connected: yes`) and `grep -A5 -i remote /proc/bus/input/devices`.

## Making sure Home is not swallowed by the desktop

On GNOME/KDE the `BrowserHome`/`XF86HomePage` key may open a file manager or browser before the launcher sees it, and
Super (Meta) may open the activities view. Options:

1. Run the launcher as a dedicated kiosk session (recommended) so no desktop shortcut handler exists.
2. Disable the shortcut: GNOME `gsettings set org.gnome.settings-daemon.plugins.media-keys www "[]"`; KDE System Settings
   -> Shortcuts -> remove the Home Page binding.
3. Inspect what the kernel sends with `sudo evtest` (pick the remote), and remap a scancode with a hwdb entry in
   `/etc/udev/hwdb.d/70-remote-keys.hwdb` (scancodes differ per remote, so none ship with the project):

   ```
   evdev:name:*Fire TV*:*
    KEYBOARD_KEY_<scancode>=<keyname>
   ```

   Apply with `sudo systemd-hwdb update && sudo udevadm trigger`.
4. Last resort: grab the device exclusively (`evtest --grab`, or a small evdev daemon) and re-inject the keys.

## Known limits

* Assistant, YouTube, Netflix, Prime and similar app buttons usually emit no key events at all.
* Google TV remotes sometimes drop pairing after a firmware update or after being paired with another device; remove
  and pair again (`bluetoothctl remove <MAC>`).
* The microphone, power and TV-control buttons are IR/CEC functions and are not available over Bluetooth HID.
* IR-only remotes need a USB IR receiver that presents itself as a HID keyboard (for example via `ir-keytable` or
  LIRC mapping to key events); the keymap then applies unchanged.
* Windows: remotes paired through Windows work as keyboards; device listing (`input.list`) is not available.
