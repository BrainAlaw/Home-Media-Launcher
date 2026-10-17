# Design language: Apple HIG tokens

The launcher follows Apple's Human Interface Guidelines (tvOS first, with visionOS and macOS materials). Everything lives in one token layer, `src/renderer/hig.css`, loaded straight after `theme.css`. Tokens are derived from the theme contract (`--bg`, `--text`, `--accent`, `--ui-rounding`, `--ring-width` ...), so all built-in themes share one grammar yet stay visually distinct. `backend/test/hig-css.test.js` enforces the rules below.

## Token reference

| Group | Tokens |
| --- | --- |
| Scale | `--hig-px` (100vw / 1920, one tvOS point), `--hig-density` (.72), `--hig-unit` |
| Type sizes | `--hig-fs-title1` 76, `title2` 57, `title3` 48, `headline` 38, `callout` 31, `body` 29, `caption1` 25, `caption2` 23 (tvOS points times `--hig-unit`, with a readable floor) |
| Type styles | `--hig-font-title1` ... `--hig-font-caption2` (complete `font` shorthands) |
| Colour | `--hig-label`, `--hig-label-secondary`, `--hig-label-tertiary`, `--hig-label-quaternary`, `--hig-fill` / `-secondary` / `-tertiary` / `-quaternary`, `--hig-separator`, `--hig-tint`, `--hig-tint-fill`, `--hig-on-tint`, `--hig-destructive` |
| Materials | `--hig-material-ultrathin` / `thin` / `regular` / `thick`, `--hig-material-edge`, `--hig-scrim`, `--hig-highlight` |
| Shape | `--hig-radius-xs` / `sm` / `md` / `lg` / `xl` / `pill` |
| Spacing | `--hig-grid` (8pt), `--hig-space-1` / `2` / `3` / `4` / `6` / `8` |
| Elevation | `--hig-elev-1` ... `--hig-elev-4`, `--hig-clip-safe` |
| Motion | `--hig-dur-fast` 200ms, `--hig-dur-base` 350ms, `--hig-dur-slow` 500ms, `--hig-ease-standard`, `--hig-ease-in`, `--hig-ease-out`, `--hig-ease-spring`, `--hig-ease-spring-soft` |
| Focus | `--hig-focus-scale` (1.08 to 1.1), `--hig-focus-edge`, `--hig-focus-lift`, `--hig-focus-sheen`, `--hig-parallax` |

## How each principle was applied

**Typography.** tvOS text styles are mapped onto the launcher's canvas. One tvOS point equals `100vw / 1920`, so 1080p and 4K scale linearly; `--hig-density` (.72) compensates for the launcher's denser layout. Section titles use title3, tile labels callout, secondary copy caption1. Weights are medium to semibold, never light, because thin strokes shimmer on TVs.

**Colour and vibrancy.** Four label levels derive from the theme's text colour at 100 / 92 / 68 / 24 percent. Fills and separators use the same colour at low alpha. The test composites every preset's elevated surface over the worst-case wallpaper (pure white or black, already dimmed by `.shade`) and requires label and secondary at 4.5:1 (WCAG AA) and tertiary at 3:1, on the thin, regular and thick materials.

**Materials.** Real glass needs `backdrop-filter`, which is the most expensive thing on a low-power HTPC and cannot be animated cheaply. Materials are therefore static gradients: a faint top highlight over `--bg-elevated` at 66 / 88 / 94 / 97 percent. Nothing in `hig.css`, the dialog, toast, host badge, panels or wallpaper credit blurs. The single live blurred surface is the system menu panel (`.menu-panel`), which is never open together with a sheet. Sheets (`dialog`) use the thick material and animate scale and opacity freely.

**Shape.** Radii scale with the theme's `--ui-rounding`, so sharp and retro themes stay sharp. Concentric rule: a child inside padding `P` of a parent with radius `R` uses `max(0, R - P)`; tiles, art and the focus edge share `inherit`. Where supported, `corner-shape: squircle` gives continuous corners.

**Layout.** All spacing is a multiple of the 8pt grid (`--hig-space-*`), scaled with the canvas. Safe margins stay in `--gutter`.

**Elevation.** Four shadow tiers, the widest being 24px offset plus 56px blur. Scroll containers that hold lifted content reserve `--hig-clip-safe` or more (`--track-pad-y` in `home.css`), so a shadow is never clipped. The legacy `--shadow-*` tokens alias these tiers.

**Motion.** Durations are 200 / 350 / 500 ms. Springs are sampled damped oscillators via `linear()`, with a cubic-bezier fallback. Reduced motion collapses durations to 1 to 160 ms, removes overshoot and parallax, and lowers the focus scale to 1.04.

**Focus (tvOS).** The focused tile scales to 1.08 to 1.1, rises on a tinted lift shadow, shows image parallax and a one-shot specular sheen, and keeps a hairline edge (for WCAG 2.4.7) instead of a hard outline. Only the focused tile carries `will-change`.

**Alerts, sheets, lists, buttons.** Sheets sit on a scrim with the thick material and spring in. List rows and buttons use fill levels; focus raises the fill, adds the edge and a 2 percent scale. Destructive actions use `--hig-destructive`.

**Accessibility.** Contrast is tested per theme, motion has reduced variants, focus never relies on colour alone (scale plus edge plus lift), and text never drops below 12 to 15px.

## Performance rules (enforced by tests)

1. No `transition: all`, and no transition on layout properties (width, height, margin, padding, font, grid, flex ...) in the owned stylesheets.
2. Transitions in `home.css`, `launch-transition.css` and any `.tile` rule touch only `transform`, `opacity` and `visibility`.
3. `@keyframes` animate only `transform`, `opacity` and `visibility`.
4. `will-change` appears only on focus, open and covering states.
5. `backdrop-filter` is `none` everywhere except `.menu-panel`.
6. Rows use `contain: layout style` and the focused row is raised with `:has(.tile.focused)`. `content-visibility: auto` is deliberately not used: it implies paint containment, which would clip focus shadows; the virtualised grid already limits live nodes.
7. Battery level and wizard progress animate with `transform` instead of `width`.
8. The launch cover animates transform and opacity only.

## Not verified without a display

Real-frame timing (60 fps), squircle rendering, the exact look of every theme under a bright wallpaper, and 4K scaling were reasoned about and tested statically only. Run the launcher on target hardware and compare against the Performance meter.
