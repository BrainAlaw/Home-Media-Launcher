# Remote controls in websites and Chromium web apps

Fullscreen website windows accept navigation from a standard gamepad and Bluetooth TV remotes. The preload translates mapped input into synthetic keyboard `keydown` and `keyup` events for the focused page element.

## Supported controls

- Gamepad D-pad and left stick: arrow keys. Directions begin repeating after 380 ms, then repeat every 90 ms.
- Gamepad A: Enter. Gamepad B: Escape as a normal tap, so the page can use its own Escape behaviour. Holding B for 700 ms still exits.
- Bluetooth remote arrows and Enter: arrow keys and Enter. `Back`, `BrowserBack`, and `GoBack` become Escape.
- Hold remote `Home` or `BrowserHome` for 700 ms to close the web app and return to the launcher. A short press is ignored by the page.
- Hold gamepad Guide (button 16) for 700 ms to exit. Escape held for 700 ms and Select + Start together remain available as exit gestures.

The existing exit overlay appears while a hold gesture is in progress. The launcher closes the website window and restores focus when an exit gesture completes.

## Limitations

- Some pages ignore synthetic keyboard events or only respond to trusted physical keyboard input.
- Pointer-only interfaces cannot be fully operated with these controls.
- Login forms that require text entry still need a keyboard.
- Remote key names depend on what the operating system reports through `KeyboardEvent.key` or `.code`.

## Changing the mapping

Edit [`remote-keymap.json`](remote-keymap.json). It is the source of truth for gamepad button indexes, remote key names, the left-stick deadzone, long-press duration, and exit buttons. Restart the launcher after editing; each website receives the mapping when its window opens. Actions are `up`, `down`, `left`, `right`, `confirm`, `back`, and `exit`. The gamepad exit button list defaults to `[16]` (Guide).

If the argument is missing or invalid, website input mapping is disabled and the built-in Guide, Escape, B, and Select + Start exit gestures remain available.
