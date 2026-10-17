'use strict';

/**
 * Settings dialog: appearance (theme, accent, font, backdrop), wallpapers and their sources, applications,
 * websites and per-item icons. Talks to the backend only through the `window.launcher` bridge passed in via init().
 */
window.SettingsDialog = (function () {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#settings-dialog');
  const Sources = window.WallpaperSources;
  let ctx;
  /** Staged theme choices; previewed live and only persisted on Save. @type {import('./theme').ThemeSettings} */
  let themeDraft = {};
  /** Staged wallpaper source (custom file, bundled gallery pick or slideshow). */
  let wallpaperDraft = {};
  /** Staged wallpaper sources (folders and online catalogues), see settings.wallpaperSources. @type {import('./wallpaper-sources').WallpaperSource[]} */
  let sourcesDraft = [];
  /** Backend report per source id (counts, availability, cache size). @type {Map<string, any>} */
  let sourceInfo = new Map();
  let cacheBytes = 0;
  let onlineAvailable = true;
  let infoToken = 0;
  /** Staged UI font id ('theme' follows the preset). */
  let fontDraft = 'theme';
  /** Staged settings.performance (auto | quality | lite). */
  let performanceDraft = 'auto';
  /** Compact selects of the Appearance page (built in buildThemeControls / buildFontControls). */
  let presetSelect = null;
  let fontSelect = null;

  const ICON_HINT = 'Preferred sizes: tile art 1280×720 (16:9) · icon 512×512 PNG or SVG · game poster 600×900';

  /** @param {string} tag @param {Record<string, any>} props */
  function el(tag, props = {}) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    return node;
  }

  function textInput(className, placeholder, value) {
    return el('input', { type: 'text', className, placeholder, value: value || '' });
  }

  function removeButton(card) {
    const button = el('button', { type: 'button', className: 'remove', textContent: 'Remove' });
    button.addEventListener('click', () => card.remove());
    return button;
  }

  /* ------------------------------------------------------------------ icon fields */

  /** Calls an extension namespace; rejects when the bridge or the namespace is not available yet. */
  async function callExt(namespace, method, ...args) {
    const bridge = window.launcher?.ext;
    if (!bridge || typeof bridge.invoke !== 'function') throw new Error('Extension bridge unavailable');
    return bridge.invoke(namespace, method, ...args);
  }

  /** @param {unknown} result artwork search result: an array, or an object with a `results` array */
  function artworkUrls(result) {
    const list = Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : []);
    return list.map((item) => (typeof item === 'string' ? item : item?.url)).filter((url) => typeof url === 'string' && url).slice(0, 12);
  }

  /**
   * Icon editor for one item: preview, path field, Auto, Browse, Search artwork and Clear.
   * Overrides win over any other icon source. `describe()` supplies the item's current name / address.
   * @param {{ className: string, value?: string, kind: 'app' | 'website' | 'game', describe: () => { name: string, url?: string }, onChange?: (value: string) => void }} options
   */
  function createIconField({ className, value, kind, describe, onChange }) {
    const wrap = el('div', { className: 'icon-field' });
    const preview = el('div', { className: 'icon-preview' });
    const image = el('img', { alt: '' });
    image.addEventListener('error', () => image.removeAttribute('src'));
    preview.append(image);
    const input = textInput(className, 'Icon image path or web address (optional)', value);
    const status = el('small', { className: 'icon-status', textContent: '' });
    const results = el('div', { className: 'artwork-results', hidden: true });
    const hint = el('small', { className: 'icon-hint', textContent: ICON_HINT });
    const buttons = ['Auto', 'Browse…', 'Search artwork', 'Clear'].map((label) => el('button', { type: 'button', textContent: label }));
    const [auto, browse, search, clear] = buttons;
    const group = el('div', { className: 'button-group' });
    group.append(...buttons);

    const setStatus = (message) => { status.textContent = message; };
    const sync = () => {
      const source = input.value.trim();
      if (source && window.AssetUrl.isLoadableImage(source)) image.src = window.AssetUrl.assetUrl(source);
      else image.removeAttribute('src');
      onChange?.(source);
    };
    const choose = (source) => {
      input.value = source;
      results.hidden = true;
      results.replaceChildren();
      sync();
    };
    const busy = (isBusy) => buttons.forEach((button) => { button.disabled = isBusy; });

    input.addEventListener('input', sync);
    clear.addEventListener('click', () => { choose(''); setStatus('Icon cleared - the automatic artwork is used'); });
    browse.addEventListener('click', async () => {
      const selected = await window.launcher.chooseFile('icon');
      if (!selected) return;
      if (/\.(mp4|webm)$/i.test(selected)) { setStatus('Icons must be image files'); return; }
      choose(selected);
      setStatus('');
    });
    auto.addEventListener('click', async () => {
      const { name, url } = describe();
      if (!name && !url) { setStatus('Enter a name first'); return; }
      busy(true);
      setStatus('Looking for an icon…');
      try {
        const result = await callExt('icons', 'resolve', { kind, name, ...(url ? { url } : {}) });
        const found = result && typeof result.url === 'string' ? result.url : '';
        if (!found) setStatus('No automatic icon found - try Search artwork or Browse');
        else { choose(found); setStatus(`Automatic icon applied${result.source ? ` (${result.source})` : ''}`); }
      } catch { setStatus('Automatic icons are not available - use Browse or Search artwork'); }
      finally { busy(false); }
    });
    search.addEventListener('click', async () => {
      const { name } = describe();
      if (!name) { setStatus('Enter a name first'); return; }
      busy(true);
      setStatus('Searching artwork…');
      results.replaceChildren();
      results.hidden = true;
      try {
        const urls = artworkUrls(await callExt('icons', 'searchArtwork', name));
        if (!urls.length) { setStatus('No artwork found'); return; }
        for (const url of urls) {
          const candidate = el('button', { type: 'button', className: 'artwork-candidate', title: 'Use this artwork' });
          candidate.setAttribute('aria-label', 'Use this artwork');
          const thumb = el('img', { alt: '', loading: 'lazy', decoding: 'async', src: window.AssetUrl.assetUrl(url) });
          thumb.addEventListener('error', () => candidate.remove());
          candidate.append(thumb);
          candidate.addEventListener('click', () => { choose(url); setStatus('Artwork selected'); });
          results.append(candidate);
        }
        results.hidden = false;
        setStatus('Pick an artwork');
        results.querySelector('button')?.focus();
      } catch { setStatus('Artwork search is not available'); }
      finally { busy(false); }
    });

    const controls = el('div', { className: 'icon-controls' });
    controls.append(input, group, status, results, hint);
    wrap.append(preview, controls);
    sync();
    return { element: wrap, input };
  }

  /** Labelled form field; the label wraps the control so a click or the D-pad focuses it. */
  function field(labelText, control, className = '') {
    const wrap = el('label', { className: `card-field ${className}`.trim() });
    wrap.append(el('span', { className: 'card-label', textContent: labelText }), control);
    return wrap;
  }

  /** Card header: the name input grows, Remove sits at the end. */
  function cardHead(card, name) {
    const head = el('div', { className: 'card-head' });
    head.append(field('Name', name, 'grow'), removeButton(card));
    return head;
  }

  function addWebsiteCard(website = {}, icon = website.icon) {
    const card = el('div', { className: 'application-card website-card' });
    card.dataset.id = website.id || `website:${crypto.randomUUID()}`;
    const name = textInput('website-name', 'Name', website.name);
    const url = textInput('website-url', 'https://example.com', website.url);
    const iconField = createIconField({ className: 'website-icon', value: icon, kind: 'website', describe: () => ({ name: name.value.trim(), url: url.value.trim() }) });
    card.append(cardHead(card, name), field('Address', url, 'wide'), iconField.element);
    $('#website-editor').append(card);
  }

  function addEditorCard(tile = {}, { icon = tile.icon, legacyId = '' } = {}) {
    const card = el('div', { className: 'application-card' });
    card.dataset.id = tile.id || `custom:${crypto.randomUUID()}`;
    if (legacyId) card.dataset.legacyId = legacyId;
    const name = textInput('app-name', 'Name', tile.name);
    const iconField = createIconField({ className: 'app-icon', value: icon, kind: 'app', describe: () => ({ name: name.value.trim() }) });
    card.append(
      cardHead(card, name),
      field('Command or executable', textInput('app-command', 'Command or executable path', tile.command), 'wide'),
      field('Arguments', textInput('app-args', 'e.g. stream PC Desktop', (tile.args || []).join(' '))),
      field('Tile background (optional)', textInput('app-background', 'Image path or address', tile.background)),
      iconField.element
    );
    $('#application-editor').append(card);
    return card;
  }

  /* ------------------------------------------------------------------ appearance */

  function updateDraft(patch) {
    themeDraft = { ...themeDraft, ...patch };
    syncThemeControls();
    ctx.previewTheme(themeDraft);
  }

  /** Mirrors the staged theme, accent and font onto the mini launcher in the Appearance page. */
  function syncAppearancePreview() {
    const preview = $('#appearance-preview');
    if (!preview) return;
    window.ThemeEngine.apply(preview, themeDraft);
    window.ThemeEngine.applyFont?.(preview, fontDraft);
  }

  /* ------------------------------------------------------------------ compact select */

  /** The currently expanded select, if any (only one at a time). @type {{ wrap: HTMLElement, trigger: HTMLButtonElement, list: HTMLElement } | null} */
  let openSelect = null;

  function closeSelect({ refocus = true } = {}) {
    if (!openSelect) return false;
    const { trigger, list } = openSelect;
    openSelect = null;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (refocus) trigger.focus();
    return true;
  }

  /**
   * Gamepad-operable select: a trigger button plus an inline listbox of option buttons. Native <select> popups are
   * not reachable from the spatial navigation (click() does not open them), so options are ordinary buttons.
   * @param {{ container: HTMLElement, label: string, groups: { title?: string, options: { value: string, name: string, detail?: string, theme?: string, font?: string }[] }[], onPick: (value: string) => void }} config
   */
  function createSelect({ container, label, groups, onPick }) {
    container.replaceChildren();
    const wrap = el('div', { className: 'select-wrap' });
    const trigger = el('button', { type: 'button', className: 'select-trigger' });
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', label);
    const triggerChips = el('span', { className: 'select-chips' });
    triggerChips.append(el('i'), el('i'));
    const triggerText = el('span', { className: 'select-text' });
    const triggerName = el('strong', { className: 'select-name' });
    const triggerDetail = el('small', { className: 'select-detail' });
    triggerText.append(triggerName, triggerDetail);
    const caret = el('span', { className: 'select-caret', textContent: '▾' });
    caret.setAttribute('aria-hidden', 'true');
    trigger.append(triggerChips, triggerText, caret);
    const list = el('div', { className: 'select-list', hidden: true });
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', label);
    /** @type {Map<string, HTMLButtonElement>} */
    const items = new Map();
    /** @type {Map<string, any>} */
    const byValue = new Map();
    for (const group of groups) {
      if (group.title) list.append(el('h5', { className: 'select-group', textContent: group.title }));
      for (const option of group.options) {
        byValue.set(option.value, option);
        const item = el('button', { type: 'button', className: 'select-option' });
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.dataset.value = option.value;
        if (option.font) item.style.setProperty('--option-font', option.font);
        const chips = el('span', { className: 'select-chips' });
        if (option.theme) { chips.dataset.theme = option.theme; chips.append(el('i'), el('i')); } else chips.hidden = true;
        const text = el('span', { className: 'select-text' });
        text.append(el('strong', { className: 'select-name', textContent: option.name }));
        if (option.detail) text.append(el('small', { className: 'select-detail', textContent: option.detail }));
        item.append(chips, text);
        item.addEventListener('click', () => { closeSelect(); onPick(option.value); });
        items.set(option.value, item);
        list.append(item);
      }
    }
    trigger.addEventListener('click', () => {
      if (openSelect?.list === list) { closeSelect(); return; }
      closeSelect({ refocus: false });
      openSelect = { wrap, trigger, list };
      list.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      (list.querySelector('[aria-selected="true"]') || list.querySelector('.select-option'))?.focus();
    });
    wrap.addEventListener('focusout', (event) => {
      if (openSelect?.wrap === wrap && !wrap.contains(event.relatedTarget)) closeSelect({ refocus: false });
    });
    wrap.addEventListener('keydown', (event) => {
      if (openSelect?.wrap !== wrap) return;
      const options = [...list.querySelectorAll('.select-option')];
      const index = options.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        options[Math.max(0, Math.min(index + (event.key === 'ArrowDown' ? 1 : -1), options.length - 1))]?.focus();
      } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSelect(); }
    });
    wrap.append(trigger, list);
    container.append(wrap);
    return {
      /** Marks `value` as the current choice and mirrors it onto the trigger. */
      setValue(value) {
        const option = byValue.get(value) || byValue.values().next().value;
        for (const [key, item] of items) item.setAttribute('aria-selected', String(key === option.value));
        triggerName.textContent = option.name;
        triggerDetail.textContent = option.detail || '';
        triggerDetail.hidden = !option.detail;
        triggerChips.hidden = !option.theme;
        if (option.theme) triggerChips.dataset.theme = option.theme; else delete triggerChips.dataset.theme;
        if (option.font) trigger.style.setProperty('--option-font', option.font); else trigger.style.removeProperty('--option-font');
      }
    };
  }

  /** Builds the theme select and accent swatches once; syncThemeControls() only flips state so focus survives. */
  function buildThemeControls() {
    closeSelect({ refocus: false });
    presetSelect = createSelect({
      container: $('#preset-picker'),
      label: 'Theme preset',
      groups: [{ options: window.ThemeEngine.PRESETS.map((preset) => ({ value: preset.id, name: preset.name, detail: preset.description, theme: preset.id })) }],
      onPick: (preset) => updateDraft({ preset })
    });

    const accents = $('#accent-picker');
    accents.replaceChildren();
    const presetDefault = el('button', { type: 'button', textContent: 'Preset accent' });
    presetDefault.dataset.accent = '';
    presetDefault.addEventListener('click', () => updateDraft({ accent: '' }));
    accents.append(presetDefault);
    for (const color of window.ThemeEngine.ACCENT_SWATCHES) {
      const swatch = el('button', { type: 'button', className: 'swatch' });
      swatch.dataset.accent = color;
      swatch.style.setProperty('--swatch', color);
      swatch.setAttribute('aria-label', `Accent ${color}`);
      swatch.addEventListener('click', () => updateDraft({ accent: color }));
      accents.append(swatch);
    }
    const custom = el('input', { type: 'color', id: 'accent-custom', value: '#3d8bff' });
    custom.setAttribute('aria-label', 'Custom accent colour');
    custom.addEventListener('input', () => { themeDraft = { ...themeDraft, accent: custom.value }; ctx.previewTheme(themeDraft); syncAppearancePreview(); });
    custom.addEventListener('change', () => updateDraft({ accent: custom.value }));
    accents.append(custom);
  }

  function syncThemeControls() {
    const resolved = window.ThemeEngine.resolve(themeDraft);
    presetSelect?.setValue(resolved.preset);
    for (const button of document.querySelectorAll('#accent-picker button')) {
      button.setAttribute('aria-pressed', String(button.dataset.accent === resolved.accent));
    }
    if (resolved.accent) $('#accent-custom').value = resolved.accent;
    $('#dynamic-art').checked = resolved.dynamicArt;
    $('#live-video').checked = resolved.liveVideo;
    syncAppearancePreview();
  }

  function syncPerformanceControl() {
    document.querySelectorAll('#performance-mode button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === performanceDraft));
      button.onclick = () => { performanceDraft = button.dataset.mode; syncPerformanceControl(); };
    });
  }

  function updateFont(fontId) {
    fontDraft = fontId;
    syncFontControls();
    ctx.previewFont(fontDraft);
  }

  const FONT_CATEGORY_LABELS = { system: 'System', sans: 'Sans-serif', rounded: 'Rounded', tech: 'Tech', mono: 'Monospace', display: 'Display', serif: 'Serif', condensed: 'Condensed' };

  function buildFontControls() {
    closeSelect({ refocus: false });
    const fonts = window.ThemeEngine.FONTS || [];
    const groups = [{ options: [{ value: 'theme', name: 'Match theme', detail: 'Each theme brings its own typeface' }] }];
    for (const font of fonts) {
      let group = groups.at(-1);
      const title = FONT_CATEGORY_LABELS[font.category] || font.category;
      if (group.title !== title) { group = { title, options: [] }; groups.push(group); }
      group.options.push({ value: font.id, name: font.name, font: font.stack });
    }
    fontSelect = createSelect({ container: $('#font-picker'), label: 'Interface font', groups, onPick: updateFont });
  }

  function syncFontControls() {
    const known = (window.ThemeEngine.FONTS || []).some((font) => font.id === fontDraft);
    fontSelect?.setValue(known ? fontDraft : 'theme');
    syncAppearancePreview();
  }

  /* ------------------------------------------------------------------ wallpapers */

  function updateWallpaper(patch) {
    wallpaperDraft = { ...wallpaperDraft, ...patch };
    syncWallpaperControls();
    ctx.previewWallpaper(wallpaperDraft);
  }

  /** Mode buttons, bundled thumbnails and interval buttons are built once; sync only flips state to keep focus. */
  function buildWallpaperControls() {
    const gallery = ctx.gallery;
    const modes = $('#wallpaper-modes');
    modes.hidden = gallery.entries.length === 0;
    modes.querySelectorAll('button').forEach((button) => {
      button.onclick = () => updateWallpaper({ mode: button.dataset.mode });
    });
    const grid = $('#wallpaper-gallery');
    grid.replaceChildren();
    for (const entry of gallery.entries) {
      const thumb = el('button', { type: 'button', className: 'wallpaper-thumb', title: entry.name });
      thumb.dataset.id = entry.id;
      thumb.setAttribute('aria-label', entry.name);
      const image = el('img', { alt: '', loading: 'lazy', decoding: 'async', src: gallery.urlFor(entry, document.baseURI, 'thumb') });
      thumb.append(image, el('span', { textContent: entry.name }));
      thumb.addEventListener('click', () => updateWallpaper({ mode: 'bundled', id: entry.id }));
      grid.append(thumb);
    }
    const intervals = $('#slideshow-interval');
    intervals.replaceChildren();
    for (const option of window.Wallpapers.INTERVALS) {
      const button = el('button', { type: 'button', textContent: option.label });
      button.dataset.seconds = String(option.seconds);
      button.addEventListener('click', () => updateWallpaper({ mode: 'slideshow', intervalSec: option.seconds }));
      intervals.append(button);
    }
    $('#slideshow-source').querySelectorAll('button').forEach((button) => {
      button.onclick = () => updateWallpaper({ mode: 'slideshow', source: button.dataset.source });
    });
  }

  /** Stages a new source list and mirrors it onto the legacy playback fields (enabled folders, online flag). */
  function commitSources(next) {
    sourcesDraft = Sources.normaliseSources(next);
    updateWallpaper(Sources.projectToWallpaper(wallpaperDraft, sourcesDraft));
    void refreshSourceInfo();
  }

  function sourceStats(source) {
    const info = sourceInfo.get(source.id);
    if (!info) return 'Checking…';
    if (source.kind === 'folder') {
      if (!info.available) return info.error || 'Folder not found';
      return `${info.images} image${info.images === 1 ? '' : 's'}, ${info.videos} video${info.videos === 1 ? '' : 's'}`;
    }
    const parts = [info.count ? `${info.count} wallpaper${info.count === 1 ? '' : 's'}` : 'No wallpapers loaded'];
    if (info.cacheBytes) parts.push(`${Sources.formatBytes(info.cacheBytes)} cached`);
    if (info.error) parts.push(info.error);
    return parts.join(' · ');
  }

  function bundledRow() {
    const row = el('div', { className: 'source-row builtin' });
    const text = el('div', { className: 'source-text' });
    const count = ctx.gallery.entries.length;
    text.append(
      el('strong', { textContent: 'Bundled gallery' }),
      el('small', { textContent: 'Built in · always available offline' }),
      el('small', { className: 'source-stats', textContent: `${count} wallpaper${count === 1 ? '' : 's'} · CC0 / public domain` })
    );
    row.append(el('span', { className: 'source-kind', textContent: 'Built in' }), text);
    return row;
  }

  function sourceRow(source, resolved) {
    const row = el('div', { className: 'source-row' });
    row.dataset.enabled = String(source.enabled);
    const text = el('div', { className: 'source-text' });
    const builtin = Sources.parseOnlineLocation(source.kind === 'online' ? source.location : '');
    const where = source.kind === 'folder' ? source.location
      : builtin.ok && builtin.builtin ? `Built-in provider · ${builtin.host}` : source.location;
    const stats = el('small', { className: 'source-stats', textContent: sourceStats(source) });
    const info = sourceInfo.get(source.id);
    stats.classList.toggle('problem', Boolean(info && (source.kind === 'folder' ? !info.available : info.error && !info.count)));
    text.append(el('strong', { textContent: source.label }), el('small', { textContent: where, title: where }), stats);

    const actions = el('div', { className: 'source-actions' });
    const toggle = el('button', { type: 'button', className: 'source-toggle', textContent: source.enabled ? 'On' : 'Off' });
    toggle.dataset.focusKey = `${source.id}:toggle`;
    toggle.setAttribute('aria-pressed', String(source.enabled));
    toggle.setAttribute('aria-label', `${source.label}: ${source.enabled ? 'enabled' : 'disabled'}`);
    toggle.addEventListener('click', () => commitSources(sourcesDraft.map((candidate) => (candidate.id === source.id ? { ...candidate, enabled: !candidate.enabled } : candidate))));
    actions.append(toggle);
    if (source.kind === 'folder' && source.enabled) {
      const use = el('button', { type: 'button', textContent: 'Use as slideshow' });
      use.dataset.focusKey = `${source.id}:use`;
      use.setAttribute('aria-pressed', String(resolved.mode === 'slideshow' && resolved.source === 'folder' && resolved.folderPath === source.location));
      use.addEventListener('click', () => updateWallpaper({ mode: 'slideshow', source: 'folder', folderPath: source.location }));
      actions.append(use);
    }
    const remove = el('button', { type: 'button', className: 'remove', textContent: 'Remove' });
    remove.dataset.focusKey = `${source.id}:remove`;
    remove.setAttribute('aria-label', `Remove ${source.label}`);
    remove.addEventListener('click', () => commitSources(sourcesDraft.filter((candidate) => candidate.id !== source.id)));
    actions.append(remove);
    row.append(el('span', { className: 'source-kind', textContent: source.kind === 'folder' ? 'Folder' : 'Online' }), text, actions);
    return row;
  }

  /** Rebuilds the source rows (few items) and restores keyboard / gamepad focus to the same control. */
  function renderSources() {
    const list = $('#wallpaper-sources');
    const focusKey = dialog.contains(document.activeElement) ? document.activeElement.dataset?.focusKey || '' : '';
    const resolved = ctx.gallery.resolve(wallpaperDraft, 'slideshow');
    list.replaceChildren(bundledRow(), ...sourcesDraft.map((source) => sourceRow(source, resolved)));
    renderKnownProviders();
    if (focusKey) {
      const target = [...dialog.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focusKey) || $('#add-wallpaper-folder');
      target?.focus();
    }
  }

  function renderKnownProviders() {
    const container = $('#known-providers');
    container.replaceChildren();
    for (const provider of Sources.BUILTIN_PROVIDERS) {
      if (sourcesDraft.some((source) => source.kind === 'online' && source.location === provider.location)) continue;
      const button = el('button', { type: 'button', textContent: `+ ${provider.label}`, title: provider.description });
      button.dataset.focusKey = `provider:${provider.id}`;
      button.addEventListener('click', () => { void addOnlineSource(provider.location); });
      container.append(button);
    }
  }

  function renderOnlineStatus() {
    $('#online-status').textContent = onlineAvailable
      ? `Downloaded wallpapers use ${Sources.formatBytes(cacheBytes)} on this device.`
      : 'Online wallpapers are not available in this build.';
    $('#clear-online-wallpapers').disabled = !onlineAvailable;
    $('#add-online-source').disabled = !onlineAvailable;
    $('#online-source-url').disabled = !onlineAvailable;
  }

  /** Asks the main process for counts and cache sizes of the staged sources. */
  async function refreshSourceInfo() {
    const token = ++infoToken;
    try {
      const report = await window.launcher.wallpaperSources('inspect', { sources: sourcesDraft });
      if (token !== infoToken) return;
      sourceInfo = new Map(report.sources.map((info) => [info.id, info]));
      cacheBytes = report.cacheBytes || 0;
      onlineAvailable = report.onlineAvailable !== false;
    } catch (error) {
      if (token !== infoToken) return;
      sourceInfo = new Map(sourcesDraft.map((source) => [source.id, { id: source.id, kind: source.kind, count: 0, available: false, cacheBytes: 0, error: 'Unable to check this source' }]));
    }
    renderSources();
    renderOnlineStatus();
  }

  async function addWallpaperFolder() {
    try {
      const info = await window.launcher.pickWallpaperFolder();
      if (!info) return;
      if (sourcesDraft.some((source) => source.kind === 'folder' && source.location === info.path)) { ctx.showToast('Folder already added'); return; }
      const created = Sources.createSource('folder', info.path, info.name);
      if (created.error) { ctx.showToast(created.error); return; }
      if (sourcesDraft.length >= Sources.MAX_SOURCES) { ctx.showToast('Too many wallpaper sources'); return; }
      commitSources([...sourcesDraft, created.source]);
      if (!info.total) ctx.showToast('No images or videos found in that folder');
    } catch (error) { ctx.showToast(`Unable to add folder: ${error.message}`); }
  }

  /** Validates (https only, no credentials) and, for custom catalogues, probes the address before adding it. */
  async function addOnlineSource(rawLocation) {
    const parsed = Sources.parseOnlineLocation(rawLocation);
    if (!parsed.ok) { ctx.showToast(parsed.error); return; }
    if (sourcesDraft.some((source) => source.kind === 'online' && source.location === parsed.location)) { ctx.showToast('That source is already added'); return; }
    if (sourcesDraft.length >= Sources.MAX_SOURCES) { ctx.showToast('Too many wallpaper sources'); return; }
    let label = '';
    if (!parsed.builtin) {
      const button = $('#add-online-source');
      button.disabled = true;
      ctx.showToast('Checking the catalogue…');
      try {
        const probe = await window.launcher.wallpaperSources('probe', { location: parsed.location });
        if (!probe.ok) { ctx.showToast(`Cannot add source: ${probe.error || 'no usable wallpapers found'}`); return; }
        label = probe.name;
      } catch (error) { ctx.showToast(`Cannot add source: ${error.message}`); return; }
      finally { button.disabled = !onlineAvailable; }
    }
    const created = Sources.createSource('online', parsed.location, label);
    if (created.error) { ctx.showToast(created.error); return; }
    $('#online-source-url').value = '';
    commitSources([...sourcesDraft, created.source]);
    ctx.showToast('Online source added - it applies when you save');
  }

  function syncWallpaperControls() {
    const resolved = ctx.gallery.resolve(wallpaperDraft, $('#wallpaper').value.trim() ? 'custom' : 'slideshow');
    document.querySelectorAll('#wallpaper-modes button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === resolved.mode)));
    $('#wallpaper-custom').hidden = resolved.mode !== 'custom';
    $('#wallpaper-gallery').hidden = resolved.mode !== 'bundled';
    $('#slideshow-options').hidden = resolved.mode !== 'slideshow';
    document.querySelectorAll('.wallpaper-thumb').forEach((thumb) => thumb.setAttribute('aria-pressed', String(thumb.dataset.id === resolved.id)));
    document.querySelectorAll('#slideshow-interval button').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.seconds) === resolved.intervalSec)));
    document.querySelectorAll('#slideshow-source button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.source === resolved.source)));
    $('#wallpaper-shuffle').checked = resolved.shuffle;
    renderSources();
    const entry = resolved.mode === 'bundled' ? ctx.gallery.get(resolved.id) : null;
    $('#wallpaper-credit').textContent = entry
      ? `${entry.name} — ${entry.author}, ${entry.license}, via Wikimedia Commons`
      : resolved.mode === 'slideshow' ? `Cycles through the ${resolved.source} wallpapers${resolved.shuffle ? ' in random order' : ''}. Game cover art still takes priority per item.` : '';
  }

  /** Called when the dialog closes without saving, so the previewed theme can be reverted by the app. */
  function resetDraft(theme) {
    themeDraft = { ...theme };
  }

  /* ------------------------------------------------------------------ applications */

  /**
   * One row per discovered application (icon thumbnail, name and source, enable toggle) plus an optional icon override (stored in settings.iconOverrides,
   * the same storage the former Icons page used).
   */
  function populateCatalog(overrides) {
    const apps = ctx.getModel()?.availableApps || [];
    const groups = [
      { provider: 'remote', catalogId: 'remote-application-catalog', countId: 'remote-catalog-count', kind: 'game', sourceLabel: 'VibePollo / Moonlight' },
      { provider: 'local', catalogId: 'local-application-catalog', countId: 'local-catalog-count', kind: 'app', sourceLabel: 'Installed on this PC' }
    ];
    for (const group of groups) {
      const groupApps = apps.filter((app) => app.provider === group.provider);
      const catalog = $(`#${group.catalogId}`);
      const count = $(`#${group.countId}`);
      catalog.replaceChildren();
      for (const app of groupApps) {
        const entry = el('div', { className: 'catalog-entry' });
        entry.dataset.appId = app.id;
        entry.dataset.icon = overrides[app.id] || '';
        // Thumbnail: opens the icon picker below the row; falls back to the app's initial.
        const thumb = el('button', { type: 'button', className: 'catalog-thumb' });
        thumb.setAttribute('aria-label', `Change icon for ${app.name}`);
        thumb.setAttribute('aria-expanded', 'false');
        const thumbImage = el('img', { alt: '' });
        thumbImage.addEventListener('error', () => thumbImage.removeAttribute('src'));
        const initial = el('span', { className: 'catalog-initial', textContent: (app.name || '?').trim().charAt(0).toUpperCase() });
        initial.setAttribute('aria-hidden', 'true');
        thumb.append(thumbImage, initial);
        const showThumb = () => {
          const source = entry.dataset.icon || app.icon || '';
          if (source && window.AssetUrl.isLoadableImage(source)) thumbImage.src = window.AssetUrl.assetUrl(source);
          else thumbImage.removeAttribute('src');
          thumb.classList.toggle('has-icon', Boolean(entry.dataset.icon));
        };
        showThumb();
        const info = el('span', { className: 'catalog-info' });
        info.append(el('strong', { className: 'catalog-name', textContent: app.name, title: app.name }), el('small', { textContent: group.sourceLabel }));
        const toggle = el('label', { className: 'catalog-toggle' });
        const checkbox = el('input', { type: 'checkbox', className: 'catalog-checkbox', value: app.id, checked: app.selected });
        checkbox.setAttribute('aria-label', `Show ${app.name} on the home screen`);
        toggle.append(checkbox);
        let panel = null;
        thumb.addEventListener('click', () => {
          if (!panel) {
            panel = el('div', { className: 'catalog-icon-panel' });
            const iconField = createIconField({
              className: 'catalog-icon', value: entry.dataset.icon, kind: group.kind, describe: () => ({ name: app.name }),
              onChange: (value) => { entry.dataset.icon = value; showThumb(); }
            });
            panel.append(iconField.element);
            entry.append(panel);
          } else panel.hidden = !panel.hidden;
          entry.classList.toggle('open', !panel.hidden);
          thumb.setAttribute('aria-expanded', String(!panel.hidden));
        });
        entry.append(thumb, info, toggle);
        catalog.append(entry);
      }
      const updateCount = () => { count.textContent = `${catalog.querySelectorAll('.catalog-checkbox:checked').length}/${groupApps.length}`; };
      catalog.onchange = updateCount;
      updateCount();
    }
  }

  function splitArguments(value) {
    const matches = value.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    return matches.map((part) => part.replace(/^"|"$/g, ''));
  }

  function populate() {
    const config = ctx.getConfig();
    const settings = config.settings || {};
    const header = settings.header || {};
    const remote = settings.remote || {};
    const overrides = settings.iconOverrides || {};
    $('#show-text').checked = header.showText === true;
    $('#header-text').value = header.text || '';
    $('#show-date').checked = header.showDate !== false;
    $('#show-time').checked = header.showTime !== false;
    $('#show-weather').checked = header.showWeather === true;
    $('#weather-location').value = header.weatherLocation || '';
    $('#wallpaper').value = settings.background?.source || '';
    resetDraft(settings.theme || {});
    wallpaperDraft = { ...settings.wallpaper };
    sourcesDraft = Sources.deriveSources(settings.wallpaper, settings.wallpaperSources).sources;
    wallpaperDraft = { ...wallpaperDraft, ...Sources.projectToWallpaper(wallpaperDraft, sourcesDraft) };
    sourceInfo = new Map();
    $('#wallpaper-credit-toggle').checked = settings.wallpaperCredit !== false;
    performanceDraft = window.Perf.normalizeMode(settings.performance);
    window.AppearanceSettings.populate(settings);
    syncPerformanceControl();
    fontDraft = settings.fontId || 'theme';
    buildWallpaperControls();
    syncWallpaperControls();
    renderOnlineStatus();
    void refreshSourceInfo();
    buildFontControls();
    syncFontControls();
    buildThemeControls();
    syncThemeControls();
    $('#scan-desktop').checked = settings.scanDesktopEntries !== false;
    $('#remote-enabled').checked = remote.enabled === true;
    $('#remote-host').value = remote.host || '';
    $('#remote-api-url').value = remote.apiUrl || '';
    $('#remote-token').value = '';
    $('#allow-self-signed').checked = remote.allowSelfSigned === true;
    $('#moonlight-path').value = remote.moonlightPath || 'moonlight';
    window.launcher.getRemoteCredentialStatus().then((configured) => {
      $('#token-status').textContent = configured ? 'Token stored securely by the operating system' : 'Token is not configured';
    });
    $('#application-editor').replaceChildren();
    config.rows.forEach((row) => row.tiles.forEach((tile, index) => {
      const legacyId = `custom:${row.id || 'row'}:${index}`;
      addEditorCard(tile, { icon: overrides[tile.id] || overrides[legacyId] || tile.icon, legacyId });
    }));
    $('#website-editor').replaceChildren();
    (config.websites || []).forEach((website, index) => addWebsiteCard(website, overrides[website.id] || overrides[`website:${index}`] || website.icon));
    populateCatalog(overrides);
  }

  function collect() {
    const config = ctx.getConfig();
    const source = $('#wallpaper').value.trim();
    const cards = [...document.querySelectorAll('#application-editor .application-card')];
    const tiles = cards.map((card) => ({
      id: card.dataset.id,
      name: card.querySelector('.app-name').value.trim(),
      command: card.querySelector('.app-command').value.trim(),
      args: splitArguments(card.querySelector('.app-args').value),
      icon: card.querySelector('.app-icon').value.trim(),
      background: card.querySelector('.app-background').value.trim()
    })).filter((tile) => tile.name && tile.command);
    const websiteCards = [...document.querySelectorAll('.website-card')];
    const websites = websiteCards.map((card) => ({
      id: card.dataset.id,
      name: card.querySelector('.website-name').value.trim(),
      url: card.querySelector('.website-url').value.trim(),
      icon: card.querySelector('.website-icon').value.trim()
    })).filter((website) => website.name && website.url);
    // Overrides of untouched items stay as they are. Custom apps and websites carry their icon in the item itself
    // (the editor field already started from any previous override), so a stale override must not shadow it.
    const iconOverrides = { ...(config.settings?.iconOverrides || {}) };
    for (const card of [...cards, ...websiteCards]) {
      delete iconOverrides[card.dataset.id];
      if (card.dataset.legacyId) delete iconOverrides[card.dataset.legacyId];
    }
    // Positional website ids (website:0, ...) only existed for websites saved without an id; every saved website has one now.
    for (const key of Object.keys(iconOverrides)) if (/^website:\d+$/.test(key)) delete iconOverrides[key];
    for (const entry of document.querySelectorAll('.catalog-entry')) {
      if (entry.dataset.icon) iconOverrides[entry.dataset.appId] = entry.dataset.icon;
      else delete iconOverrides[entry.dataset.appId];
    }
    return {
      settings: {
        ...config.settings,
        scanDesktopEntries: $('#scan-desktop').checked,
        selectedAppIds: [...document.querySelectorAll('.catalog-checkbox:checked')].map((checkbox) => checkbox.value),
        background: { type: /\.(mp4|webm)$/i.test(source) ? 'video' : 'image', source },
        theme: { ...themeDraft },
        fontId: fontDraft,
        wallpaper: ctx.gallery.resolve(wallpaperDraft, source ? 'custom' : 'slideshow'),
        wallpaperSources: sourcesDraft,
        wallpaperCredit: $('#wallpaper-credit-toggle').checked,
        performance: performanceDraft,
        ...window.AppearanceSettings.collect(),
        iconOverrides,
        header: {
          showText: $('#show-text').checked,
          text: $('#header-text').value.trim(),
          showDate: $('#show-date').checked,
          showTime: $('#show-time').checked,
          showWeather: $('#show-weather').checked,
          weatherLocation: $('#weather-location').value.trim()
        },
        remote: {
          enabled: $('#remote-enabled').checked,
          host: $('#remote-host').value.trim(),
          moonlightPath: $('#moonlight-path').value.trim() || 'moonlight',
          apiUrl: $('#remote-api-url').value.trim(),
          allowSelfSigned: $('#allow-self-signed').checked
        }
      },
      rows: [{ id: 'custom', title: 'Applications', tiles }],
      websites
    };
  }

  /** Persists the form (and any newly entered token) and hands the fresh model back to the app. */
  async function save() {
    const token = $('#remote-token').value.trim();
    if (token) await window.launcher.saveRemoteToken(token);
    const nextConfig = collect();
    const nextModel = await window.launcher.saveSettings(nextConfig);
    ctx.setConfig(nextConfig);
    ctx.onModel(nextModel);
    return nextModel;
  }

  function open() {
    populate();
    dialog.showModal();
  }

  function close() {
    closeSelect({ refocus: false });
    window.ControllersPage?.setActive(false);
    if (dialog.open) dialog.close();
  }

  function init(context) {
    ctx = context;
    window.AppearanceSettings.init();
    $('#dynamic-art').addEventListener('change', (event) => updateDraft({ dynamicArt: event.target.checked }));
    $('#live-video').addEventListener('change', (event) => updateDraft({ liveVideo: event.target.checked }));
    $('#wallpaper-shuffle').addEventListener('change', (event) => updateWallpaper({ shuffle: event.target.checked }));
    $('#add-wallpaper-folder').addEventListener('click', addWallpaperFolder);
    $('#add-online-source').addEventListener('click', () => { void addOnlineSource($('#online-source-url').value); });
    $('#online-source-url').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void addOnlineSource(event.target.value);
    });
    $('#clear-online-wallpapers').addEventListener('click', async () => {
      try {
        await window.launcher.wallpaperSources('clearCache');
        ctx.showToast('Downloaded wallpapers cleared');
        void refreshSourceInfo();
      } catch (error) { ctx.showToast(`Unable to clear cache: ${error.message}`); }
    });
    $('#settings-close').addEventListener('click', ctx.onClose);
    $('#settings-cancel').addEventListener('click', ctx.onClose);
    dialog.addEventListener('close', ctx.onClose);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (!dismissPopup()) ctx.onClose(); });
    document.querySelectorAll('.settings-layout nav button').forEach((button) => button.addEventListener('click', () => {
      document.querySelectorAll('.settings-layout nav button, .settings-page').forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      $(`.settings-page[data-page="${button.dataset.page}"]`).classList.add('active');
      window.ControllersPage?.setActive(button.dataset.page === 'controllers');
    }));
    $('#browse-wallpaper').addEventListener('click', async () => {
      const selected = await window.launcher.chooseFile('wallpaper');
      if (selected) $('#wallpaper').value = selected;
    });
    $('#browse-moonlight').addEventListener('click', async () => {
      const selected = await window.launcher.chooseFile('application');
      if (selected) $('#moonlight-path').value = selected;
    });
    $('#refresh-remote').addEventListener('click', async () => {
      const button = $('#refresh-remote');
      button.disabled = true;
      try {
        const model = await save();
        populate();
        ctx.showToast(model.remoteStatus.status === 'online' ? 'VibePollo list refreshed' : 'Server unavailable — using cache');
      } catch (error) { ctx.showToast(`VibePollo error: ${error.message}`); }
      finally { button.disabled = false; }
    });
    $('#add-local').addEventListener('click', async () => {
      const selected = await window.launcher.chooseFile('application');
      if (!selected) return;
      const name = selected.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
      if (/\.ps1$/i.test(selected)) addEditorCard({ name, command: 'powershell.exe', args: ['-NoProfile', '-File', selected] });
      else if (/\.(cmd|bat)$/i.test(selected)) addEditorCard({ name, command: 'cmd.exe', args: ['/d', '/s', '/c', selected] });
      else addEditorCard({ name, command: selected });
    });
    $('#add-command').addEventListener('click', () => addEditorCard());
    $('#add-moonlight').addEventListener('click', () => addEditorCard({ name: 'Moonlight', command: 'moonlight-qt', args: ['stream', 'HOST-NAME', 'Desktop'] }));
    $('#add-website').addEventListener('click', () => addWebsiteCard());
    $('#settings-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await save();
        ctx.onClose();
        ctx.showToast('Settings saved');
      } catch (error) { ctx.showToast(`Unable to save settings: ${error.message}`); }
    });
  }

  /** Collapses an open select; true when one was open (the caller then swallows the Back / Escape press). */
  function dismissPopup() { return closeSelect(); }

  /** Option buttons of the open select, so D-pad navigation stays inside the list; null when nothing is expanded. */
  function popupControls() {
    return openSelect ? [...openSelect.list.querySelectorAll('.select-option')] : null;
  }

  return { init, open, close, dismissPopup, popupControls };
})();
