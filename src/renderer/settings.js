'use strict';

/**
 * Settings dialog: appearance, applications, websites and per-tile icon overrides.
 * Talks to the backend only through the `window.launcher` bridge passed in via init().
 */
window.SettingsDialog = (function () {
  const $ = (selector) => document.querySelector(selector);
  const dialog = $('#settings-dialog');
  let ctx;
  /** Staged theme choices; previewed live and only persisted on Save. @type {import('./theme').ThemeSettings} */
  let themeDraft = {};
  /** Staged wallpaper source (custom file, bundled gallery pick or slideshow). */
  let wallpaperDraft = {};
  /** Staged UI font id ('theme' follows the preset). */
  let fontDraft = 'theme';
  /** Scan results per wallpaper folder path (image/video counts). @type {Map<string, any>} */
  const folderInfo = new Map();

  /** @param {string} tag @param {Record<string, string>} props */
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

  function addWebsiteCard(website = {}) {
    const card = el('div', { className: 'application-card website-card' });
    card.dataset.id = website.id || `website:${crypto.randomUUID()}`;
    card.append(
      textInput('website-name', 'Name', website.name),
      textInput('website-url', 'https://example.com', website.url),
      removeButton(card),
      textInput('website-icon', 'Icon URL or local path (optional)', website.icon)
    );
    $('#website-editor').append(card);
  }

  function addEditorCard(tile = {}) {
    const card = el('div', { className: 'application-card' });
    card.dataset.id = tile.id || `custom:${crypto.randomUUID()}`;
    card.append(
      textInput('app-name', 'Name', tile.name),
      textInput('app-command', 'Command or executable path', tile.command),
      removeButton(card),
      textInput('app-args', 'Arguments, e.g. stream PC Desktop', (tile.args || []).join(' ')),
      textInput('app-icon', 'Icon path (optional)', tile.icon),
      textInput('app-background', 'Tile background (optional)', tile.background)
    );
    $('#application-editor').append(card);
    return card;
  }

  /** One row per tile: preview, path field, browse and clear. Overrides win over any other icon source. */
  function addIconRow(tile, overridePath) {
    const row = el('div', { className: 'icon-row' });
    row.dataset.tileId = tile.id;
    const preview = el('div', { className: 'icon-preview' });
    const image = el('img', { alt: '' });
    image.addEventListener('error', () => image.removeAttribute('src'));
    const input = textInput('icon-path', 'Image path or URL', overridePath);
    const syncPreview = () => {
      const source = input.value.trim() || tile.icon;
      if (window.AssetUrl.isLoadableImage(source)) image.src = window.AssetUrl.assetUrl(source);
      else image.removeAttribute('src');
    };
    input.addEventListener('input', syncPreview);
    preview.append(image);
    const browse = el('button', { type: 'button', textContent: 'Browse' });
    browse.addEventListener('click', async () => {
      const selected = await window.launcher.chooseFile('wallpaper');
      if (!selected) return;
      if (/\.(mp4|webm)$/i.test(selected)) { ctx.showToast('Icons must be image files'); return; }
      input.value = selected;
      syncPreview();
    });
    const clear = el('button', { type: 'button', textContent: 'Reset' });
    clear.addEventListener('click', () => { input.value = ''; syncPreview(); });
    row.append(preview, el('span', { className: 'icon-name', textContent: tile.name }), input, browse, clear);
    syncPreview();
    $('#icon-editor').append(row);
  }

  function updateDraft(patch) {
    themeDraft = { ...themeDraft, ...patch };
    syncThemeControls();
    ctx.previewTheme(themeDraft);
  }

  /** Builds preset cards and accent swatches once; syncThemeControls() only flips state so focus survives. */
  function buildThemeControls() {
    const picker = $('#preset-picker');
    picker.replaceChildren();
    for (const preset of window.ThemeEngine.PRESETS) {
      const card = el('button', { type: 'button', className: 'preset-card' });
      card.dataset.theme = preset.id; // the card carries its own token set, so it previews itself
      card.dataset.preset = preset.id;
      const chips = el('span', { className: 'preset-chips' });
      chips.append(el('i'), el('i'));
      card.append(
        el('span', { className: 'preset-name', textContent: preset.name }),
        el('span', { className: 'preset-desc', textContent: preset.description }),
        chips
      );
      card.addEventListener('click', () => updateDraft({ preset: preset.id }));
      picker.append(card);
    }

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
    custom.addEventListener('input', () => { themeDraft = { ...themeDraft, accent: custom.value }; ctx.previewTheme(themeDraft); });
    custom.addEventListener('change', () => updateDraft({ accent: custom.value }));
    accents.append(custom);
  }

  function syncThemeControls() {
    const resolved = window.ThemeEngine.resolve(themeDraft);
    for (const card of document.querySelectorAll('#preset-picker .preset-card')) {
      card.setAttribute('aria-pressed', String(card.dataset.preset === resolved.preset));
    }
    for (const button of document.querySelectorAll('#accent-picker button')) {
      button.setAttribute('aria-pressed', String(button.dataset.accent === resolved.accent));
    }
    if (resolved.accent) $('#accent-custom').value = resolved.accent;
    $('#dynamic-art').checked = resolved.dynamicArt;
    $('#live-video').checked = resolved.liveVideo;
  }

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

  function folderSummary(info) {
    if (!info) return 'Scanning…';
    if (!info.available) return 'Folder not found';
    return `${info.images} image${info.images === 1 ? '' : 's'}, ${info.videos} video${info.videos === 1 ? '' : 's'}`;
  }

  /** Rebuilds the folder list rows (few items; rebuilt on add/remove/select). */
  function renderFolders() {
    const list = $('#wallpaper-folders');
    list.replaceChildren();
    const resolved = ctx.gallery.resolve(wallpaperDraft, 'slideshow');
    if (!resolved.folders.length) {
      list.append(el('p', { className: 'section-description', textContent: 'No folders added yet.' }));
      return;
    }
    for (const folder of resolved.folders) {
      const row = el('div', { className: 'folder-row' });
      const text = el('div', { className: 'folder-text' });
      text.append(el('strong', { textContent: folder.name }), el('small', { textContent: folder.path, title: folder.path }),
        el('small', { className: 'folder-count', textContent: folderSummary(folderInfo.get(folder.path)) }));
      const use = el('button', { type: 'button', textContent: 'Use as slideshow' });
      use.setAttribute('aria-pressed', String(resolved.mode === 'slideshow' && resolved.source === 'folder' && resolved.folderPath === folder.path));
      use.addEventListener('click', () => updateWallpaper({ mode: 'slideshow', source: 'folder', folderPath: folder.path }));
      const remove = el('button', { type: 'button', className: 'remove', textContent: 'Remove' });
      remove.addEventListener('click', () => {
        updateWallpaper({ folders: resolved.folders.filter((candidate) => candidate.path !== folder.path) });
      });
      row.append(text, use, remove);
      list.append(row);
    }
  }

  async function refreshFolderInfo() {
    const folders = ctx.gallery.resolve(wallpaperDraft, 'slideshow').folders;
    await Promise.all(folders.map(async (folder) => {
      try { folderInfo.set(folder.path, await window.launcher.inspectWallpaperFolder(folder.path)); }
      catch { folderInfo.set(folder.path, { available: false, images: 0, videos: 0, total: 0 }); }
    }));
    renderFolders();
  }

  async function addWallpaperFolder() {
    try {
      const info = await window.launcher.pickWallpaperFolder();
      if (!info) return;
      folderInfo.set(info.path, info);
      const current = ctx.gallery.resolve(wallpaperDraft, 'slideshow');
      if (current.folders.some((folder) => folder.path === info.path)) { ctx.showToast('Folder already added'); return; }
      updateWallpaper({ folders: [...current.folders, { path: info.path, name: info.name }] });
      if (!info.total) ctx.showToast('No images or videos found in that folder');
    } catch (error) { ctx.showToast(`Unable to add folder: ${error.message}`); }
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
    $('#online-wallpapers').checked = resolved.online;
    renderFolders();
    const entry = resolved.mode === 'bundled' ? ctx.gallery.get(resolved.id) : null;
    $('#wallpaper-credit').textContent = entry
      ? `${entry.name} — ${entry.author}, ${entry.license}, via Wikimedia Commons`
      : resolved.mode === 'slideshow' ? `Cycles through the ${resolved.source} wallpapers${resolved.shuffle ? ' in random order' : ''}. Game cover art still takes priority per item.` : '';
  }

  async function refreshOnlineStatus() {
    let status = { available: false, count: 0 };
    try { status = await window.launcher.getOnlineWallpaperStatus(); } catch { /* treated as unavailable */ }
    $('#online-wallpapers').disabled = !status.available;
    $('#clear-online-wallpapers').disabled = !status.available;
    $('#online-status').textContent = status.available ? `${status.count} wallpapers in the online catalogue` : 'Online wallpapers are not available in this build.';
  }

  /* ------------------------------------------------------------------ fonts */

  function updateFont(fontId) {
    fontDraft = fontId;
    syncFontControls();
    ctx.previewFont(fontDraft);
  }

  const FONT_CATEGORY_LABELS = { system: 'System', sans: 'Sans-serif', rounded: 'Rounded', tech: 'Tech', mono: 'Monospace', display: 'Display', serif: 'Serif', condensed: 'Condensed' };

  function buildFontControls() {
    const picker = $('#font-picker');
    picker.replaceChildren();
    const fonts = window.ThemeEngine.FONTS || [];
    const match = el('button', { type: 'button', className: 'font-card' });
    match.dataset.font = 'theme';
    match.append(el('span', { className: 'font-name', textContent: 'Match theme' }), el('span', { className: 'font-sample', textContent: 'Each theme brings its own typeface' }));
    match.addEventListener('click', () => updateFont('theme'));
    picker.append(match);
    let category = '';
    for (const font of fonts) {
      if (font.category !== category) {
        category = font.category;
        picker.append(el('h4', { className: 'font-category', textContent: FONT_CATEGORY_LABELS[category] || category }));
      }
      const card = el('button', { type: 'button', className: 'font-card' });
      card.dataset.font = font.id;
      card.style.setProperty('--card-font', font.stack);
      card.append(el('span', { className: 'font-name', textContent: font.name }), el('span', { className: 'font-sample', textContent: 'The quick brown fox jumps over the lazy dog 0123456789' }));
      card.addEventListener('click', () => updateFont(font.id));
      picker.append(card);
    }
  }

  function syncFontControls() {
    const known = (window.ThemeEngine.FONTS || []).some((font) => font.id === fontDraft);
    const effective = known ? fontDraft : 'theme';
    document.querySelectorAll('#font-picker .font-card').forEach((card) => card.setAttribute('aria-pressed', String(card.dataset.font === effective)));
  }

  /** Called when the dialog closes without saving, so the previewed theme can be reverted by the app. */
  function resetDraft(theme) {
    themeDraft = { ...theme };
  }

  function populateCatalog() {
    const apps = ctx.getModel()?.availableApps || [];
    const groups = [
      { provider: 'remote', catalogId: 'remote-application-catalog', countId: 'remote-catalog-count' },
      { provider: 'local', catalogId: 'local-application-catalog', countId: 'local-catalog-count' }
    ];
    for (const group of groups) {
      const groupApps = apps.filter((app) => app.provider === group.provider);
      const catalog = $(`#${group.catalogId}`);
      const count = $(`#${group.countId}`);
      catalog.replaceChildren();
      for (const app of groupApps) {
        const label = el('label', { className: 'toggle-row catalog-item' });
        const checkbox = el('input', { type: 'checkbox', className: 'catalog-checkbox', value: app.id, checked: app.selected });
        label.append(el('span', { textContent: app.name }), checkbox);
        catalog.append(label);
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
    $('#show-text').checked = header.showText === true;
    $('#header-text').value = header.text || '';
    $('#show-date').checked = header.showDate !== false;
    $('#show-time').checked = header.showTime !== false;
    $('#show-weather').checked = header.showWeather === true;
    $('#weather-location').value = header.weatherLocation || '';
    $('#wallpaper').value = settings.background?.source || '';
    resetDraft(settings.theme || {});
    wallpaperDraft = { ...settings.wallpaper };
    fontDraft = settings.fontId || 'theme';
    buildWallpaperControls();
    syncWallpaperControls();
    void refreshFolderInfo();
    void refreshOnlineStatus();
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
    config.rows.flatMap((row) => row.tiles).forEach(addEditorCard);
    $('#website-editor').replaceChildren();
    (config.websites || []).forEach(addWebsiteCard);
    populateCatalog();
    $('#icon-editor').replaceChildren();
    const overrides = settings.iconOverrides || {};
    ctx.getTiles().forEach((tile) => addIconRow(tile, overrides[tile.id]));
  }

  function collect() {
    const config = ctx.getConfig();
    const source = $('#wallpaper').value.trim();
    const tiles = [...document.querySelectorAll('#application-editor .application-card')].map((card) => ({
      id: card.dataset.id,
      name: card.querySelector('.app-name').value.trim(),
      command: card.querySelector('.app-command').value.trim(),
      args: splitArguments(card.querySelector('.app-args').value),
      icon: card.querySelector('.app-icon').value.trim(),
      background: card.querySelector('.app-background').value.trim()
    })).filter((tile) => tile.name && tile.command);
    const websites = [...document.querySelectorAll('.website-card')].map((card) => ({
      id: card.dataset.id,
      name: card.querySelector('.website-name').value.trim(),
      url: card.querySelector('.website-url').value.trim(),
      icon: card.querySelector('.website-icon').value.trim()
    })).filter((website) => website.name && website.url);
    const iconOverrides = {};
    for (const row of document.querySelectorAll('#icon-editor .icon-row')) {
      const value = row.querySelector('.icon-path').value.trim();
      if (value) iconOverrides[row.dataset.tileId] = value;
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
    window.ControllersPage?.setActive(false);
    if (dialog.open) dialog.close();
  }

  function init(context) {
    ctx = context;
    $('#dynamic-art').addEventListener('change', (event) => updateDraft({ dynamicArt: event.target.checked }));
    $('#live-video').addEventListener('change', (event) => updateDraft({ liveVideo: event.target.checked }));
    $('#wallpaper-shuffle').addEventListener('change', (event) => updateWallpaper({ shuffle: event.target.checked }));
    $('#online-wallpapers').addEventListener('change', (event) => updateWallpaper({ online: event.target.checked }));
    $('#add-wallpaper-folder').addEventListener('click', addWallpaperFolder);
    $('#clear-online-wallpapers').addEventListener('click', async () => {
      try { await window.launcher.clearOnlineWallpapers(); ctx.showToast('Downloaded wallpapers cleared'); }
      catch (error) { ctx.showToast(`Unable to clear cache: ${error.message}`); }
    });
    $('#settings-close').addEventListener('click', ctx.onClose);
    $('#settings-cancel').addEventListener('click', ctx.onClose);
    dialog.addEventListener('close', ctx.onClose);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); ctx.onClose(); });
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

  return { init, open, close };
})();
