# Launch sessions, transitions and the exit gesture

Namespace `session` (`src/main/ext/session.js`). Events: `phase` (`SessionPhase`: idle / launching / running / closing), `notice` (`{ message }`, shown as a toast). Methods: `closeActive()`, `getPhase()`, `getStatus()`.

## Transitions

- Launch: the renderer (`src/renderer/launch-transition.js`) FLIP-expands a black cover from the focused tile to fullscreen while the launcher UI fades and scales out (transform and opacity only, `prefers-reduced-motion` reduces it to a short fade). Rendering is suspended (`suspendUi`: slideshow timers, video background, hero debouncer, animations) only after the screen is black. The main process polling (host monitor) is paused while the phase is `running` and resumes with an immediate refresh on `idle`.
- Hand-off: the launcher window keeps covering the screen. Native apps: it is hidden once at least 520 ms have passed and the app took the focus (`blur`), at most 2.2 s. Website windows: shown on `ready-to-show`, then the launcher is hidden 200 ms later; inside the page a black cover fades out (about 380 ms).
- Close: the launcher is raised (still black) before the application disappears, then `app-closed` / `process-finished` and the `idle` phase make the renderer fade the cover away, scale the UI back in and spring-settle the originating tile.
- Failure: a launch error returns the session to `idle`; the renderer animates back and shows "Launch failed: ...". A spawn error after start follows the normal finished path ("Process failed: ...").

## Closing applications without a keyboard

Hold the Guide/Home button (about 700 ms). A glass "Close <app>?" panel with a progress ring appears after 150 ms.

| Target | Detection | Overlay |
| --- | --- | --- |
| Website windows | Inside the page (`web-preload.js`): Gamepad API button 16, Escape held, B held, or Select + Start. Alt+F4 / Browser Back close immediately (main process). | In the page (shadow DOM popover). |
| Native / Moonlight, Linux | Main process reads evdev (`/dev/input/eventN`, non-blocking) of devices that expose a `jsN` node; `BTN_MODE` (0x13c) is the Guide button for Xbox, PlayStation and most HID pads. | Small transparent always-on-top `BrowserWindow` (`exit-overlay.js`), created on demand, never focused, mouse-transparent. |
| Native / Moonlight, Windows | A hidden PowerShell process polls `XInputGetStateEx` (ordinal 100, exposes Guide) every 30 ms and prints the button mask. Also used for website windows because Chromium does not report Guide on Windows. | Same overlay window. |

Why not the HTML5 Gamepad API for native apps: it only reports to a focused, visible document, so it is blind while another application has focus. Electron has no main-process gamepad API. The helper-free options above (evdev reads, XInput via the OS-provided DLL) were chosen over a native module so nothing has to be compiled or shipped. The watcher only runs while an application is running, so there is no idle cost.

### Limits

- Linux: needs read access to `/dev/input/event*` (usually the `input` group or logind `uaccess`); otherwise `getStatus().guideAvailable` is false and a warning is logged. Gamepads must expose a joystick node (`joydev`). Bluetooth pads that only expose a keyboard-style Home key are not detected.
- Wayland: clients cannot force always-on-top, so on native Wayland (the Electron default in a Wayland session unless `--ozone-platform=x11`) no overlay is attempted. The hold gesture then closes the application directly after 700 ms and a toast "Closed <app>" is shown on return. Run with `--ozone-platform=x11` (XWayland) to get the overlay on compositors that honour it for X11 windows.
- Windows: the Xbox Game Bar steals the Guide button; disable it (Settings, Gaming, Game Bar) or the hold may open the Game Bar instead. PowerShell must be available (it is part of Windows). Only XInput controllers report Guide.
- Escape held can only be detected inside website windows. Native applications are closed with Alt+F4 (window manager) or the Guide hold.
- Keyboard focus-based overlays: if the compositor refuses `showInactive()` or always-on-top, the overlay marks itself failed and the hold falls back to a direct close with a toast.

## Moonlight quit chord

Moonlight quits the stream itself on Start + Select + L1 + R1; its process then exits and the normal `finished` path restores the launcher. The watcher also sees the chord (`combo`) and, if the stream process is still alive 2.5 s later (hung client, wrapper script), calls the same `closeActive()` path.

## Process termination

`ProcessManager.terminate()`: Windows `taskkill /pid <pid> /t /f` (whole tree). POSIX: SIGTERM to the process group (children are spawned detached, so the child leads its group), then SIGKILL to the group after 3 s if it is still registered. Applications that call `setsid` or hand over to an already running instance (Steam, Flatpak sandboxes, browsers reusing a profile) can escape the group; the launcher then returns once the tracked wrapper process exits.
