(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ThemeEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Theme state persisted in config.settings.theme.
   * @typedef {{ preset?: string, accent?: string, liveVideo?: boolean, dynamicArt?: boolean }} ThemeSettings
   * @typedef {{ preset: string, accent: string, liveVideo: boolean, dynamicArt: boolean }} ResolvedTheme
   */

  // Compact palette table: [id, name, description, style, background, surface, accent, accent2, text].
  // Tokens for every row are generated into theme.css (GENERATED block, produced by renderThemeCss() in backend/builtin-themes.js; a test keeps them in sync);
  // the first three presets are hand-tuned and keep their own blocks. The backend derives its built-in
  // themes from this table, so a preset and its backend theme can never drift apart.
  const PALETTE_ROWS = [
    ['console', 'Console Classic', 'Rich blurred art that follows your focus', 'custom', '#080d18', '#1a2438', '#3d8bff', '#9db8ff', '#ffffff'],
    ['oled', 'OLED Minimalist', 'Pitch black, thin borders, soft glow', 'custom', '#000000', '#0c0c0c', '#9db8ff', '#d4e0ff', '#ffffff'],
    ['neon', 'Cyberpunk Neon', 'Magenta and cyan, scanlines, angled edges', 'custom', '#05020d', '#120a29', '#ff2bd6', '#00f0ff', '#f6ecff'],
    ['tokyo', 'Neon Tokyo', 'Rain-soaked pink and cyan city lights', 'sharp', '#0a0b1a', '#15173a', '#ff3d81', '#3df5ff', '#f1f0ff'],
    ['synthwave', 'Synthwave', 'Retro-futurist violet with sunset orange', 'retro', '#120425', '#2a0a4a', '#ff4fd8', '#ffb62e', '#fbeaff'],
    ['cyber-yellow', 'Cyberpunk Yellow', 'Hazard yellow on asphalt black', 'sharp', '#0c0c08', '#1d1c0f', '#fcee0a', '#00e5ff', '#fffde0'],
    ['aurora', 'Aurora Borealis', 'Polar green rippling into violet', 'glass', '#04121a', '#0b2a33', '#3dffb4', '#8a6bff', '#e9fff8'],
    ['deep-ocean', 'Deep Ocean', 'Abyssal navy with bioluminescent teal', 'glass', '#020b1a', '#0a2342', '#2fb6ff', '#00ffd0', '#e6f4ff'],
    ['sunset-blaze', 'Sunset Blaze', 'Burning orange fading into ember red', 'glass', '#1a0709', '#3a1214', '#ff6a2b', '#ffc233', '#fff1e6'],
    ['rose-gold', 'Rose Gold', 'Warm blush metal on dark plum', 'soft', '#1a1114', '#33222a', '#f2b5a7', '#ffd9c9', '#fff3ee'],
    ['emerald', 'Emerald Forest', 'Deep jungle green with lime light', 'glass', '#04120b', '#0d2b1c', '#2ecc71', '#d4f56a', '#eafff0'],
    ['dracula', 'Dracula', 'The classic purple and pink on charcoal', 'soft', '#282a36', '#343746', '#bd93f9', '#ff79c6', '#f8f8f2'],
    ['nord', 'Nord', 'Frosted arctic blues and calm greens', 'soft', '#2e3440', '#3b4252', '#88c0d0', '#a3be8c', '#eceff4'],
    ['gruvbox', 'Gruvbox', 'Retro earthy amber and orange', 'soft', '#282828', '#3c3836', '#fabd2f', '#fe8019', '#ebdbb2'],
    ['solarized', 'Solarized Dark', 'Precision teal and gold', 'soft', '#002b36', '#073642', '#2aa198', '#b58900', '#eee8d5'],
    ['mocha', 'Catppuccin Mocha', 'Cosy mauve on warm dark', 'glass', '#1e1e2e', '#313244', '#cba6f7', '#f5c2e7', '#cdd6f4'],
    ['macchiato', 'Catppuccin Macchiato', 'Soft periwinkle and lavender', 'glass', '#24273a', '#363a4f', '#8aadf4', '#c6a0f6', '#cad3f5'],
    ['frappe', 'Catppuccin Frappe', 'Peach and orchid on slate', 'glass', '#303446', '#414559', '#ef9f76', '#ca9ee6', '#c6d0f5'],
    ['midnight-purple', 'Midnight Purple', 'Royal violet at the witching hour', 'glass', '#0d0517', '#221040', '#a259ff', '#ff7ad9', '#f3e9ff'],
    ['crimson-noir', 'Crimson Noir', 'Blood red in near-total darkness', 'sharp', '#0a0405', '#1f0a0e', '#e11d48', '#ff8fa3', '#fbe9ec'],
    ['arctic', 'Arctic Ice', 'Glacial cyan and crystalline white', 'glass', '#071420', '#12304a', '#9fe7ff', '#ffffff', '#f2fbff'],
    ['lava', 'Lava', 'Molten orange cracking through basalt', 'sharp', '#120403', '#2b0d08', '#ff3b0a', '#ffb300', '#fff0e8'],
    ['matrix', 'Matrix Green', 'Phosphor green digital rain', 'retro', '#000a02', '#04200a', '#00ff41', '#9dff9d', '#d6ffdf'],
    ['candy', 'Candy Pop', 'Bubblegum pink and electric aqua', 'glass', '#1b1030', '#33205c', '#ff5fa2', '#5ff0ff', '#fff0fa'],
    ['mono-oled', 'Monochrome OLED', 'Pure black and pure white, nothing else', 'soft', '#000000', '#0d0d0d', '#ffffff', '#bdbdbd', '#ffffff'],
    ['amber', 'Amber Terminal', 'Vintage amber CRT monitor', 'retro', '#0a0600', '#1c1100', '#ffb000', '#ff7a00', '#ffd98a'],
    ['vaporwave', 'Vaporwave', 'Cyan and pink on dusk purple', 'retro', '#1a0b2e', '#2d1b52', '#01cdfe', '#ff71ce', '#fdf0ff'],
    ['electric-blue', 'Electric Blue', 'Voltage-blue on midnight', 'sharp', '#01040f', '#071a4a', '#1e6bff', '#00e0ff', '#eaf1ff'],
    ['copper', 'Copper', 'Burnished copper and bronze', 'soft', '#140a06', '#2e1a10', '#d9824a', '#f2c18d', '#fbeee2'],
    ['mint', 'Mint', 'Fresh mint over deep teal', 'soft', '#05140f', '#0e2e24', '#7dffc7', '#c9fff0', '#effff9'],
    ['lavender', 'Lavender', 'Dusky lilac with pink highlights', 'soft', '#14111f', '#2a2442', '#b8a4ff', '#ffc6f0', '#f4f0ff'],
    ['cherry-blossom', 'Cherry Blossom', 'Sakura pink on twilight plum', 'soft', '#1c1015', '#3a1d2b', '#ff9ec4', '#ffd1e3', '#fff0f6'],
    ['steel', 'Steel', 'Brushed gunmetal and cold chrome', 'soft', '#0e1114', '#1f262d', '#8fa6bd', '#d0dae5', '#eef2f6'],
    ['forest-night', 'Forest Night', 'Moss green under a moonlit canopy', 'soft', '#08110d', '#14261c', '#6fbf73', '#e0c36a', '#e8f3ea'],
    ['dune', 'Dune', 'Spice-gold desert sand at dusk', 'soft', '#17110a', '#33271a', '#e3b25c', '#c76d3a', '#f7ead2'],
    ['tokyo-night', 'Tokyo Night Storm', 'Stormy indigo with lilac accents', 'soft', '#1a1b26', '#24283b', '#7aa2f7', '#bb9af7', '#c0caf5'],
    ['one-dark', 'One Dark', 'Familiar editor-dark with sky blue', 'soft', '#21252b', '#2c313a', '#61afef', '#e5c07b', '#dcdfe4'],
    ['monokai', 'Monokai', 'Lime and hot pink on olive-grey', 'sharp', '#272822', '#3e3d32', '#a6e22e', '#f92672', '#f8f8f2'],
    ['ayu', 'Ayu Mirage', 'Golden yellow and sky on slate', 'soft', '#1f2430', '#2a3040', '#ffcc66', '#73d0ff', '#cccac2'],
    ['rose-pine', 'Rose Pine', 'Muted rose and gold on dark violet', 'soft', '#191724', '#26233a', '#eb6f92', '#f6c177', '#e0def4'],
    ['everforest', 'Everforest', 'Gentle sage and clay greens', 'soft', '#272e33', '#374247', '#a7c080', '#e69875', '#e3d8bc'],
    ['miami', 'Miami Nights', 'Coral and teal on navy', 'glass', '#0a0f24', '#1a1f4a', '#ff5e5b', '#00d9c0', '#f4f6ff'],
    ['toxic', 'Toxic Slime', 'Radioactive lime and mint', 'sharp', '#080f00', '#1a2a05', '#b6ff00', '#00ffa3', '#f1ffd9'],
    ['royal-gold', 'Royal Gold', 'Regal gold on obsidian', 'glass', '#0f0c05', '#2a2108', '#ffd24a', '#fff1b8', '#fff8e1']
  ];

  /** Bundled fonts (src/renderer/fonts.css). `system` needs no @font-face. */
  const FONTS = Object.freeze([
    ['system', 'System UI', 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', 'system'],
    ['inter', 'Inter', '"Inter", "SF Pro Display", "Segoe UI", system-ui, sans-serif', 'sans'],
    ['manrope', 'Manrope', '"Manrope", "Segoe UI", system-ui, sans-serif', 'sans'],
    ['outfit', 'Outfit', '"Outfit", "Segoe UI", system-ui, sans-serif', 'sans'],
    ['plus-jakarta-sans', 'Plus Jakarta Sans', '"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif', 'sans'],
    ['nunito', 'Nunito', '"Nunito", "Segoe UI", system-ui, sans-serif', 'rounded'],
    ['quicksand', 'Quicksand', '"Quicksand", "Nunito", "Segoe UI", system-ui, sans-serif', 'rounded'],
    ['fredoka', 'Fredoka', '"Fredoka", "Nunito", "Segoe UI", system-ui, sans-serif', 'rounded'],
    ['orbitron', 'Orbitron', '"Orbitron", "Bahnschrift", "Segoe UI", system-ui, sans-serif', 'tech'],
    ['rajdhani', 'Rajdhani', '"Rajdhani", "Bahnschrift", "Segoe UI", system-ui, sans-serif', 'tech'],
    ['exo-2', 'Exo 2', '"Exo 2", "Bahnschrift", "Segoe UI", system-ui, sans-serif', 'tech'],
    ['space-grotesk', 'Space Grotesk', '"Space Grotesk", "Segoe UI", system-ui, sans-serif', 'tech'],
    ['jetbrains-mono', 'JetBrains Mono', '"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace', 'mono'],
    ['share-tech-mono', 'Share Tech Mono', '"Share Tech Mono", "JetBrains Mono", Consolas, ui-monospace, monospace', 'mono'],
    ['press-start-2p', 'Press Start 2P', '"Press Start 2P", "Share Tech Mono", Consolas, ui-monospace, monospace', 'display'],
    ['righteous', 'Righteous', '"Righteous", "Segoe UI", system-ui, sans-serif', 'display'],
    ['playfair-display', 'Playfair Display', '"Playfair Display", Georgia, "Times New Roman", serif', 'serif'],
    ['lora', 'Lora', '"Lora", Georgia, "Times New Roman", serif', 'serif'],
    ['barlow-condensed', 'Barlow Condensed', '"Barlow Condensed", "Arial Narrow", "Segoe UI", system-ui, sans-serif', 'condensed']
  ].map(([id, name, stack, category]) => Object.freeze({ id, name, stack, category })));

  /** Theme-matched font per preset id. */
  const PRESET_FONTS = Object.freeze({
    console: 'inter', oled: 'inter', neon: 'rajdhani', tokyo: 'exo-2', synthwave: 'righteous', 'cyber-yellow': 'barlow-condensed',
    aurora: 'outfit', 'deep-ocean': 'plus-jakarta-sans', 'sunset-blaze': 'manrope', 'rose-gold': 'playfair-display', emerald: 'nunito',
    dracula: 'jetbrains-mono', nord: 'inter', gruvbox: 'jetbrains-mono', solarized: 'space-grotesk', mocha: 'nunito',
    macchiato: 'manrope', frappe: 'plus-jakarta-sans', 'midnight-purple': 'exo-2', 'crimson-noir': 'playfair-display', arctic: 'outfit',
    lava: 'barlow-condensed', matrix: 'share-tech-mono', candy: 'fredoka', 'mono-oled': 'space-grotesk', amber: 'share-tech-mono',
    vaporwave: 'orbitron', 'electric-blue': 'rajdhani', copper: 'lora', mint: 'quicksand', lavender: 'nunito',
    'cherry-blossom': 'lora', steel: 'barlow-condensed', 'forest-night': 'lora', dune: 'manrope', 'tokyo-night': 'inter',
    'one-dark': 'jetbrains-mono', monokai: 'jetbrains-mono', ayu: 'space-grotesk', 'rose-pine': 'plus-jakarta-sans',
    everforest: 'nunito', miami: 'outfit', toxic: 'share-tech-mono', 'royal-gold': 'playfair-display'
  });

  const PALETTES = Object.freeze(PALETTE_ROWS.map(([id, name, description, style, background, surface, accent, accent2, text]) =>
    Object.freeze({ id, name, description, style, background, surface, accent, accent2, text, fontId: PRESET_FONTS[id] || 'inter' })));

  const DYNAMIC_ART_OFF = new Set(['oled', 'mono-oled', 'matrix', 'amber']);
  const PRESETS = Object.freeze(PALETTES.map(({ id, name, description, background, surface, accent, accent2 }) => Object.freeze({
    id, name, description, swatch: Object.freeze([background, surface, accent, accent2]),
    defaults: Object.freeze({ dynamicArt: !DYNAMIC_ART_OFF.has(id) })
  })));
  const DEFAULT_PRESET = 'console';

  const ACCENT_SWATCHES = Object.freeze(['#3d8bff', '#9db8ff', '#ff2bd6', '#00f0ff', '#3dffb0', '#ffb020', '#ff5c5c', '#a78bfa']);

  const HEX = /^#[0-9a-f]{6}$/i;

  /** Picks black or white text for an accent background using WCAG relative luminance. */
  function contrastColor(hex) {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#05070d' : '#ffffff';
  }

  /**
   * Fills in defaults and discards invalid values.
   * @param {ThemeSettings | undefined} theme
   * @returns {ResolvedTheme}
   */
  function resolve(theme = {}) {
    const preset = PRESETS.find((candidate) => candidate.id === theme.preset) || PRESETS.find((candidate) => candidate.id === DEFAULT_PRESET);
    return {
      preset: preset.id,
      accent: HEX.test(theme.accent || '') ? theme.accent.toLowerCase() : '',
      liveVideo: theme.liveVideo !== false,
      dynamicArt: typeof theme.dynamicArt === 'boolean' ? theme.dynamicArt : preset.defaults.dynamicArt
    };
  }

  /**
   * Applies a theme to `element` (normally <html>): selects the preset token set and
   * layers the optional accent override on top. Returns the resolved theme.
   * @param {HTMLElement} element
   * @param {ThemeSettings | undefined} theme
   * @returns {ResolvedTheme}
   */
  function apply(element, theme) {
    const resolved = resolve(theme);
    element.dataset.theme = resolved.preset;
    if (resolved.accent) {
      element.style.setProperty('--accent', resolved.accent);
      element.style.setProperty('--accent-contrast', contrastColor(resolved.accent));
    } else {
      element.style.removeProperty('--accent');
      element.style.removeProperty('--accent-contrast');
    }
    return resolved;
  }

  /**
   * Applies a UI font to `element`. 'theme' (or an unknown id) follows the active theme's own --font-ui;
   * a known id overrides --font-ui and --font-display. Returns the effective font id ('theme' when following).
   * @param {HTMLElement} element
   * @param {string | undefined} fontId
   * @returns {string}
   */
  function applyFont(element, fontId) {
    const font = FONTS.find((candidate) => candidate.id === fontId);
    if (!font) {
      element.style.removeProperty('--font-ui');
      element.style.removeProperty('--font-display');
      return 'theme';
    }
    element.style.setProperty('--font-ui', font.stack);
    element.style.setProperty('--font-display', 'var(--font-ui)');
    return font.id;
  }

  /** Font id a preset ships with. */
  const fontForPreset = (presetId) => PRESET_FONTS[presetId] || 'inter';

  return { PALETTES, PRESETS, FONTS, ACCENT_SWATCHES, DEFAULT_PRESET, contrastColor, resolve, apply, applyFont, fontForPreset };
});
