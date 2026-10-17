'use strict';

const fs = require('node:fs/promises');
const { watch } = require('node:fs');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicWrite, serialize } = require('./storage');
const { validateTheme, validateThemeStore } = require('./theme-validation');
const { BUILTIN_THEMES } = require('./builtin-themes');

const DEFAULT_THEME = Object.freeze({
  id: 'builtin-dark', name: 'Vibepollo Dark',
  palette: { background: '#07090d', surface: '#151922', accent: '#8b5cf6', text: '#ffffff', mutedText: '#a7adbb' },
  layout: { showHeroCard: true, showClock: true, showDate: true, compactCards: false, reduceMotion: false },
  background: { type: 'none', source: '' }, sounds: { enabled: false, volume: 0.4 }
});

/** Adds shipped themes that an older store lacks; existing entries (including user edits) are never overwritten. */
function addMissingBuiltins(document) {
  const known = new Set(document.themes.map((theme) => theme.id));
  const missing = BUILTIN_THEMES.filter((theme) => !known.has(theme.id));
  if (!missing.length || document.themes.length + missing.length > 100) return false;
  document.themes.push(...structuredClone(missing));
  return true;
}

function encodeDocument(document) {
  const contents = JSON.stringify(document, null, 2);
  if (Buffer.byteLength(contents) > 8 * 1024 * 1024) throw new Error('Theme store exceeds size limit');
  return contents;
}

class ThemeService extends EventEmitter {
  constructor(directory, media) {
    super();
    this.file = path.join(directory, 'themes.json');
    this.media = media;
    this.document = null;
    this.resolved = new Map();
    this.revision = 0;
    this.signature = '';
    this.watcher = null;
    this.timer = null;
    this.closed = false;
  }

  async readDocument() {
    const handle = await fs.open(this.file, 'r');
    try {
      if ((await handle.stat()).size > 8 * 1024 * 1024) throw new Error('Theme store exceeds size limit');
      return validateThemeStore(JSON.parse(await handle.readFile('utf8')));
    } finally { await handle.close(); }
  }

  async initialize() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await serialize(this.file, async () => {
      let document;
      try { document = await this.readDocument(); }
      catch (error) {
        if (error.code !== 'ENOENT') {
          // Preserve damaged or unsupported documents before creating a usable default.
          if (error.code && !['EINVAL'].includes(error.code)) throw error;
          await fs.rename(this.file, `${this.file}.corrupt-${randomUUID()}`);
          this.emit('warning', new Error('Invalid themes.json was preserved; the default theme was restored'));
        }
        document = { version: 1, currentThemeId: DEFAULT_THEME.id, themes: [structuredClone(DEFAULT_THEME), ...structuredClone(BUILTIN_THEMES)] };
        await atomicWrite(this.file, encodeDocument(document));
      }
      if (addMissingBuiltins(document)) await atomicWrite(this.file, encodeDocument(document));
      await this.apply(document, false);
    });
    this.watcher = watch(path.dirname(this.file), { persistent: false }, (_event, filename) => {
      if (filename && filename.toString() !== path.basename(this.file)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.closed) return;
        serialize(this.file, async () => this.apply(await this.readDocument(), true))
          .catch((error) => this.emit('warning', error));
      }, 80);
      this.timer.unref?.();
    });
    this.watcher.on('error', (error) => this.emit('warning', error));
  }

  async resolve(theme) {
    const assets = { background: null, sounds: {} };
    const unavailableAssets = [];
    if (theme.background.type !== 'none') {
      try { assets.background = await this.media.register(theme.background.source, theme.background.type); }
      catch { unavailableAssets.push('background'); }
    }
    for (const key of ['focus', 'confirm', 'back']) {
      if (!theme.sounds?.[key]) continue;
      try { assets.sounds[key] = await this.media.register(theme.sounds[key], 'audio'); }
      catch { unavailableAssets.push(`sounds.${key}`); }
    }
    return { ...structuredClone(theme), assets, unavailableAssets };
  }

  async apply(document, notify) {
    const signature = JSON.stringify(document);
    if (signature === this.signature) return;
    const resolved = new Map(await Promise.all(document.themes.map(async (theme) => [theme.id, await this.resolve(theme)])));
    this.document = structuredClone(document);
    this.resolved = resolved;
    this.signature = signature;
    this.revision++;
    if (notify) this.emit('changed', this.state());
  }

  /** @returns {import('./contracts').ResolvedTheme[]} */
  getAvailableThemes() { return structuredClone([...this.resolved.values()]); }

  /** @returns {import('./contracts').ResolvedTheme} */
  getCurrentTheme() { return structuredClone(this.resolved.get(this.document.currentThemeId)); }

  /** @returns {import('./contracts').ThemeState} */
  state() { return { revision: this.revision, currentTheme: this.getCurrentTheme(), themes: this.getAvailableThemes() }; }

  /** @param {string} id @returns {Promise<import('./contracts').ResolvedTheme>} */
  setTheme(id) {
    if (typeof id !== 'string') return Promise.reject(new Error('Theme ID must be a string'));
    return serialize(this.file, async () => {
      const document = await this.readDocument();
      if (!document.themes.some((theme) => theme.id === id)) throw new Error('Unknown theme ID');
      document.currentThemeId = id;
      await atomicWrite(this.file, encodeDocument(document));
      await this.apply(document, true);
      return this.getCurrentTheme();
    });
  }

  /** @param {import('./contracts').Theme} input @returns {Promise<import('./contracts').ResolvedTheme>} */
  async saveCustomTheme(input) {
    const theme = structuredClone(validateTheme(input));
    if (theme.id === DEFAULT_THEME.id) throw new Error('Use a new ID to customize the built-in theme');
    const resolved = await this.resolve(theme);
    if (resolved.unavailableAssets.length) throw new Error(`Theme assets are unavailable: ${resolved.unavailableAssets.join(', ')}`);
    return serialize(this.file, async () => {
      const document = await this.readDocument();
      const index = document.themes.findIndex((item) => item.id === theme.id);
      if (index < 0) document.themes.push(theme);
      else document.themes[index] = theme;
      validateThemeStore(document);
      await atomicWrite(this.file, encodeDocument(document));
      await this.apply(document, true);
      return structuredClone(this.resolved.get(theme.id));
    });
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.watcher?.close();
  }
}

module.exports = { ThemeService, DEFAULT_THEME };
