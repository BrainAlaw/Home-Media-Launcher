# Mouse support audit

All conclusions below are from renderer code inspection; see [Not verified](#not-verified).

## Screens

### Home

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| App, website and category tiles | yes | yes | not needed | `app.js:830-833`; `home.css:112-116` |
| Home header/settings button | yes | yes | not needed | `app.js:849-850`; `menu.css` button states |
| Media widget controls | yes | partly | not needed | `media-widget.js:151-165`; `media-widget.css` |
| Home content area | no | no | yes | No generic pointer action; `app.js:836-840` only moves focus over `.focusable`; home scroll is in `app.js:560-565` |

### Quick settings

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| Quick settings rows (Settings, status, VPN, power) | yes | yes | not needed | `app.js:855-866`, `status-widgets.js:340`; row registration/focus `navigation-menu.js:38-48`; CSS `styles.css:167-179` |
| Ethernet speed-test button | yes | yes | not needed | `status-widgets.js:494`; generic button hover `styles.css:98` |
| Quick settings sheet background | no | no | yes | No sheet pointer handler; native vertical overflow `menu.css:79-84`; open/close animation `navigation-menu.js:87-97` |

### Settings pages

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| Page navigation (General, Appearance, Wallpapers, Applications, Remote, Websites, Controllers) | yes | yes | not needed | `settings.js:765-769`; `styles.css:201-208` |
| Form fields, toggles, selects and save/cancel/close | yes | partly | not needed | Native form controls; buttons `settings.js:744-764,800`; dialog pointer actions absent, generic `styles.css:98` |
| Appearance choices, categories and header layout | yes | partly | not needed | `settings.js:260-273`; `settings-appearance.js:36,159-161`; category actions have click only |
| Wallpaper and source controls | yes | partly | not needed | `settings.js:337-451,747-754`; generic button hover `styles.css:98` |
| Application/website editor actions and icon launchers | yes | partly | yes | `settings.js:46-119,771-799`; editor uses click only; app catalog `styles.css:242` |
| Settings navigation and page content | n/a | n/a | yes | Native overflow containers `styles.css:286-289`; Appearance panel `appearance.css:37`; select options `appearance.css:64` |

### Pairing wizard

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| Connection type, start/cancel, done, retry/close buttons | yes | yes | not needed | `pairing-wizard-ui.js:145-151,174,198,217-219`; generic dialog button hover `styles.css:98` |
| Wizard body/background | no | no | no | No pointer or wheel handler; input routing in `app.js:757-758` is action based |

### Controllers page

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| Pair new controller and refresh | yes | yes | not needed | `controllers-page.js:73-77`; generic button hover `styles.css:98` |
| Controller list/status rows | no | no | no | Rendered as status content (`controllers-page.js:21-37,61`); no row click/pointer/wheel handler |

### On-screen keyboard

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| Character, shift, layer, backspace, submit and cancel keys | yes | yes | not needed | `on-screen-keyboard.js:74-89`; keyboard keys have `.focused`/`.pressed` states; no pointer-move focus handler |
| Keyboard text field | partly | no | not needed | `on-screen-keyboard.js:106-110`; edits are handled by physical keyboard/window key routing `181-194`, not pointer input |

### Icon popup

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| Reset, cancel, save, browse, automatic artwork, search | yes | yes | not needed | `icon-popup.js:141-170`; generic dialog button hover `styles.css:98` |
| Search result choices | yes | yes | not needed | `icon-popup.js:194`; generic dialog button hover `styles.css:98` |
| Icon popup body and results | n/a | n/a | yes | Native scroll containers `settings-apps.css:35,47` |

### Media widget

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| Playback and media action buttons | yes | partly | not needed | `media-widget.js:151-165`; widget-specific visual states, no pointer hover-to-focus handler |
| Widget card surface | partly | no | not needed | `media-widget.js:456` only requests focus when interactive; does not activate the focused action |

### Launch overlay

| Control | Mouse click works | Hover feedback | Wheel scroll | Handler or missing handler |
|---|---|---|---|---|
| Launch progress card | no | no | not needed | `launch-loading.js:53-65` creates display-only progress elements; no pointer/click handler |

## Gaps

### (a) No pointer handler at all

- Quick settings sheet surface has no pointer action outside its buttons: `navigation-menu.js:87-97`.
- Pairing wizard body, controller list/status rows and launch progress card are display-only: `pairing-wizard-ui.js:133-164`, `controllers-page.js:21-37`, `launch-loading.js:53-65`.
- Home content outside `.focusable` controls has no pointer action: `app.js:830-840`.

### (b) Handler exists but does not match the keyboard action

- Clicking the media widget card only requests focus; it does not activate a media action: `media-widget.js:456` (keyboard actions dispatch from `media-widget.js:441-446`).
- Mouse movement over home tiles selects focus, while clicks both focus and activate: `app.js:830-840`; it does not expose the same directional navigation/leave behaviour as keyboard/gamepad.
- OSK text field accepts physical-key input but has no mouse typing/editing handler; only key buttons produce text: `on-screen-keyboard.js:106-110,181-194`.

### (c) Hover feedback missing

- Home non-control content, pairing body, controller status rows, launch progress card and media widget card have no hover state/handler: `app.js:836-840`, `pairing-wizard-ui.js:133-164`, `controllers-page.js:21-37`, `launch-loading.js:53-65`, `media-widget.js:456`.
- Media buttons have visual states but no pointer-move focus feedback equivalent to keyboard/gamepad focus: `media-widget.js:151-165,441-455`.
- Settings buttons and many generated choices use click handlers only; only selected settings navigation has explicit hover styling: `settings.js:46-451,765-799`, `settings-appearance.js:36-161`, `styles.css:201-208`.

### (d) Scroll containers that do not respond to the wheel

- Home virtual tracks scroll horizontally (`styles.css:59`); no custom wheel-to-horizontal-scroll handler was found.
- No other vertically scrollable renderer container inspected here disables native wheel scrolling. Settings, Quick settings, appearance controls, application catalog and icon popup use native `overflow-y: auto` (`styles.css:230,242,286-289`, `menu.css:79-84`, `appearance.css:37,64`, `settings-apps.css:35,47`).

## Not verified

Every claim in this audit comes only from reading the listed renderer JavaScript and CSS. The R10 prompt prohibits running the app, so click behaviour, hover rendering and wheel response were not verified on screen.

