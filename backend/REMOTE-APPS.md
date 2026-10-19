# Remote controls in websites and Chromium web apps

The launcher supports two website paths: Gaming websites open in a fullscreen Electron window; Home Theatre websites open in a fullscreen external Chromium browser. Both paths support controller navigation and Bluetooth TV remote keys, with different app lifecycle handling.

## Behaviour

| Input | Gaming website (Electron) | Home Theatre website (external browser) |
| --- | --- | --- |
| D-pad / left stick | Arrow navigation keys | Focus-aware directional navigation |
| A / Enter | Enter | Select focused item |
| B | Escape tap; holding B for 700 ms closes the app | Holding B for 700 ms closes the browser app |
| Home / BrowserHome | Returns to the launcher; the website stays running in the background | Returns to the launcher through the `hmlHome` binding; the browser stays running |
| Back / BrowserBack / GoBack, short press | Goes back in page history; does nothing if there is no previous entry | Goes back in page history; does nothing if there is no previous entry |
| Back / BrowserBack / GoBack, held for 700 ms | Closes the app and returns to the launcher | Closes the browser app and returns to the launcher |
| Guide (gamepad button 16), held for 700 ms | Closes the app and returns to the launcher | Closes the browser app and returns to the launcher |
| Escape held for 700 ms; Select + Start | Existing close gestures remain available | Escape held for 700 ms remains available |

Gaming web key events are synthetic keyboard events dispatched to the focused page element. Home is reported to the main process over IPC. Home Theatre controls run in the external browser; Home and close requests are reported through DevTools bindings. The launcher handles the `home` event by hiding the browser while keeping it alive, and handles `close` by terminating the browser session.

## Limitations

- Some pages ignore synthetic keyboard events or only respond to trusted physical keyboard input.
- Pointer-only interfaces cannot be fully operated with these controls.
- Login forms that require text entry still need a keyboard.
- Remote key names depend on what the operating system reports through `KeyboardEvent.key` or `.code`.
- `TvBrowserSession.hide()` and `.show()` use Chromium DevTools window-state commands, but hiding and restoring the Home Theatre browser has not yet been verified on Linux.
- Home Theatre websites require Microsoft Edge, Google Chrome, or Chromium with its local DevTools endpoint enabled.

## Changing the mapping

Edit [`remote-keymap.json`](remote-keymap.json). It is the source of truth for gamepad button indexes, remote key names, long-press keys, the left-stick deadzone, long-press duration, and close buttons. Restart the launcher after editing; each website reads the mapping when its window or browser session opens. Allowed actions are `up`, `down`, `left`, `right`, `confirm`, `back`, `close`, and `home`. The Guide close button defaults to `[16]`.

If the keymap argument is missing or invalid, Gaming websites disable key mapping but retain the built-in Guide, Escape, B, and Select + Start close gestures.
