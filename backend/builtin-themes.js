'use strict';

const { PALETTES, FONTS } = require('../src/renderer/theme');

const BUILTIN_PREFIX = 'builtin-';
const GENERATED_START = '/* ==== GENERATED THEMES START (backend/builtin-themes.js renderThemeCss) ==== */';
const GENERATED_END = '/* ==== GENERATED THEMES END ==== */';

const toRgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
const toHex = (channels) => `#${channels.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

/** Linear blend in sRGB space: `amount` of `b` mixed into `a`. */
function mix(a, b, amount) {
  const [left, right] = [toRgb(a), toRgb(b)];
  return toHex(left.map((value, index) => value + (right[index] - value) * amount));
}

const rgba = (hex, alpha) => `rgba(${toRgb(hex).join(', ')}, ${alpha})`;

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque hex colours. */
function contrastRatio(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/** Muted text keeps readable contrast on the surface: mostly text, slightly pulled toward the surface. */
const mutedTextFor = (palette) => mix(palette.text, palette.surface, 0.2);

/** @param {typeof PALETTES[number]} palette @returns {import('./contracts').Theme} */
function toBackendTheme(palette) {
  return {
    id: `${BUILTIN_PREFIX}${palette.id}`,
    name: palette.name,
    palette: {
      background: palette.background, surface: palette.surface, accent: palette.accent,
      text: palette.text, mutedText: mutedTextFor(palette)
    },
    fontId: palette.fontId,
    layout: { showHeroCard: true, showClock: true, showDate: true, compactCards: false, reduceMotion: false },
    background: { type: 'none', source: '' },
    sounds: { enabled: false, volume: 0.4 },
    extensions: { uiPreset: palette.id, accent2: palette.accent2 }
  };
}

/** Built-in themes shipped with the launcher (excluding the legacy default, which lives in theme-service). */
const BUILTIN_THEMES = Object.freeze(PALETTES.map((palette) => Object.freeze(toBackendTheme(palette))));

// Shape/glass/motion recipes for the generated presets. Colours come from the palette table.
const STYLES = {
  glass: {
    rounding: '20px', ring: '3px', cut: '0px', glassAlpha: 0.56, blur: '38px', saturate: '170%', glassBorder: 0.2,
    dim: '.46', backdropBlur: '30px', backdropSaturate: '140%', scanlines: '0', scale: '1.1', ring2: 'text',
    glow: (p) => `0 10px 28px rgba(0, 0, 0, .45), 0 0 16px ${rgba(p.accent, 0.3)}`,
    hero: (p) => `0 16px 40px rgba(0, 0, 0, .5), 0 0 24px ${rgba(p.accent, 0.26)}`,
    motion: ['140ms', '260ms', '460ms', '900ms'], ease: 'cubic-bezier(.2, .8, .2, 1)', easeFocus: 'cubic-bezier(.34, 1.28, .5, 1)',
    title: ['650', '-.03em', 'none', '0']
  },
  soft: {
    rounding: '14px', ring: '1.5px', cut: '0px', glassAlpha: 0.84, blur: '26px', saturate: '125%', glassBorder: 0.14,
    dim: '.88', backdropBlur: '44px', backdropSaturate: '110%', scanlines: '0', scale: '1.08', ring2: 'text',
    glow: (p) => `0 0 22px ${rgba(p.accent, 0.3)}`,
    hero: (p) => `0 0 32px ${rgba(p.accent, 0.22)}`,
    motion: ['120ms', '200ms', '380ms', '700ms'], ease: 'cubic-bezier(.22, .8, .24, 1)', easeFocus: 'cubic-bezier(.22, .8, .24, 1)',
    title: ['600', '-.035em', 'none', '0']
  },
  sharp: {
    rounding: '4px', ring: '2px', cut: '0px', glassAlpha: 0.74, blur: '18px', saturate: '170%', glassBorder: 0.42,
    dim: '.68', backdropBlur: '18px', backdropSaturate: '150%', scanlines: '0', scale: '1.08', ring2: 'accent2',
    glow: (p) => `0 0 16px ${rgba(p.accent, 0.7)}, 0 0 28px ${rgba(p.accent2, 0.3)}`,
    hero: (p) => `0 0 24px ${rgba(p.accent, 0.45)}`,
    motion: ['80ms', '150ms', '300ms', '420ms'], ease: 'cubic-bezier(.3, .9, .3, 1)', easeFocus: 'cubic-bezier(.3, .9, .3, 1)',
    title: ['700', '.04em', 'uppercase', '.08em']
  },
  retro: {
    rounding: '0px', ring: '2px', cut: '0px', glassAlpha: 0.78, blur: '14px', saturate: '150%', glassBorder: 0.5,
    dim: '.76', backdropBlur: '14px', backdropSaturate: '130%', scanlines: '.22', scale: '1.08', ring2: 'accent2',
    glow: (p) => `0 0 12px ${rgba(p.accent, 0.7)}, 0 0 24px ${rgba(p.accent, 0.25)}`,
    hero: (p) => `0 0 20px ${rgba(p.accent, 0.45)}`,
    motion: ['90ms', '160ms', '320ms', '480ms'], ease: 'cubic-bezier(.3, .9, .3, 1)', easeFocus: 'cubic-bezier(.3, .9, .3, 1)',
    title: ['700', '.06em', 'uppercase', '.1em']
  }
};

const fontStack = (fontId) => (FONTS.find((font) => font.id === fontId) || FONTS.find((font) => font.id === 'inter')).stack;

function renderPresetBlock(palette) {
  const recipe = STYLES[palette.style];
  const { background: bg, surface, accent, accent2, text } = palette;
  const accentContrast = luminance(accent) > 0.4 ? '#05070d' : '#ffffff';
  const [fast, base, slow, backdrop] = recipe.motion;
  const [weight, tracking, transform, labelTracking] = recipe.title;
  const fontUi = fontStack(palette.fontId);
  const fontDisplay = 'var(--font-ui)';
  return `[data-theme="${palette.id}"] {
  --bg: ${bg};
  --bg-elevated: ${mix(bg, surface, 0.45)};
  --surface: ${surface};
  --surface-hover: ${mix(surface, text, 0.1)};
  --text: ${text};
  --text-dim: ${rgba(text, 0.78)};
  --text-faint: ${rgba(text, 0.62)};
  --accent: ${accent};
  --accent-contrast: ${accentContrast};
  --accent-2: ${accent2};
  --border: ${rgba(recipe.ring2 === 'accent2' ? accent2 : text, recipe.ring2 === 'accent2' ? 0.4 : 0.18)};
  --focus-ring: ${recipe.ring2 === 'accent2' ? 'var(--accent-2)' : text};
  --danger: #ff6b7a;
  --warn: #f1c66f;
  --ok: #72d69a;

  --ui-rounding: ${recipe.rounding};
  --ring-width: ${recipe.ring};
  --cut: ${recipe.cut};

  --glass-bg: ${rgba(mix(bg, surface, 0.6), recipe.glassAlpha)};
  --glass-blur: ${recipe.blur};
  --glass-saturate: ${recipe.saturate};
  --glass-border: ${rgba(recipe.ring2 === 'accent2' ? accent2 : text, recipe.glassBorder)};

  --backdrop-dim: ${recipe.dim};
  --backdrop-blur: ${recipe.backdropBlur};
  --backdrop-saturate: ${recipe.backdropSaturate};
  --scanlines: ${recipe.scanlines};

  --focus-scale: ${recipe.scale};
  --focus-glow: ${recipe.glow(palette)};
  --hero-glow: ${recipe.hero(palette)};

  --motion-fast: ${fast};
  --motion-base: ${base};
  --motion-slow: ${slow};
  --motion-backdrop: ${backdrop};
  --ease: ${recipe.ease};
  --ease-focus: ${recipe.easeFocus};

  --font-ui: ${fontUi};
  --font-display: ${fontDisplay};
  --title-weight: ${weight};
  --title-tracking: ${tracking};
  --label-transform: ${transform};
  --label-tracking: ${labelTracking};
}
`;
}

/** Token blocks for every generated (non hand-tuned) preset, wrapped in the markers theme.css carries. */
function renderThemeCss() {
  const blocks = PALETTES.filter((palette) => palette.style !== 'custom').map(renderPresetBlock);
  return `${GENERATED_START}\n${blocks.join('\n')}${GENERATED_END}`;
}

module.exports = {
  BUILTIN_PREFIX, BUILTIN_THEMES, GENERATED_START, GENERATED_END,
  contrastRatio, mutedTextFor, renderThemeCss, toBackendTheme
};
