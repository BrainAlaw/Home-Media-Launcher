(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HeroBanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * @typedef {{
   *   id: string, name: string, type?: string, icon?: string, fanart?: string, logo?: string,
   *   description?: string, isVibepolloOffline?: boolean
   * }} HeroTile
   * Optional playtime aliases: playtimeMinutes | playtime_minutes (minutes), playtimeSeconds | playtime_seconds | playtime (seconds, Playnite convention).
   * Optional logo aliases: logo | clearLogo | clear_logo. Optional description aliases: description | summary.
   *
   * @typedef {{
   *   key: string, id: string, title: string, kicker: string, subtitle: string, description: string,
   *   logo: string, playtime: string, cta: string, offline: boolean
   * }} HeroMeta
   */

  const DEBOUNCE_MS = 150;
  const SPRING = Object.freeze({ stiffness: 240, damping: 30, mass: 1 });
  const OFFLINE_NOTICE = 'Vibepollo offline · streaming unavailable';
  const STAGGER_STEP = 0.1;

  const firstText = (...values) => {
    for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
    return '';
  };

  const firstNumber = (...values) => {
    for (const value of values) {
      const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
      if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return null;
  };

  const clamp01 = (value) => Math.min(1, Math.max(0, value));

  /**
   * Human-readable playtime for a 10-foot UI.
   * @param {number | null} minutes
   * @returns {string} empty when playtime is unknown
   */
  function formatPlaytime(minutes) {
    if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return '';
    const total = Math.floor(minutes);
    if (total < 1) return 'Not played yet';
    if (total < 60) return `${total} min played`;
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return hours >= 100 || rest === 0 ? `${hours} h played` : `${hours} h ${rest} min played`;
  }

  /**
   * Reduces a backend tile to the exact fields the banner renders. `key` changes iff the visible content changes.
   * @param {HeroTile} tile
   * @param {{ recent?: boolean, subtitle?: string }} [context]
   * @returns {HeroMeta}
   */
  function normalizeHeroMeta(tile, { recent = false, subtitle = '' } = {}) {
    const minutes = firstNumber(tile.playtimeMinutes, tile.playtime_minutes);
    const seconds = firstNumber(tile.playtimeSeconds, tile.playtime_seconds, tile.playtime);
    const meta = {
      id: String(tile.id),
      title: firstText(tile.name) || 'Untitled',
      kicker: recent ? 'Continue' : 'Featured',
      subtitle,
      description: firstText(tile.description, tile.summary),
      logo: firstText(tile.logo, tile.clearLogo, tile.clear_logo),
      playtime: formatPlaytime(minutes ?? (seconds === null ? null : seconds / 60)),
      cta: tile.type === 'website' ? 'Open' : 'Play',
      offline: tile.isVibepolloOffline === true
    };
    return { ...meta, key: JSON.stringify(meta) };
  }

  /**
   * Trailing-edge debouncer with an injectable timer for deterministic tests.
   * @template {unknown[]} A
   * @param {(...args: A) => void} callback
   * @param {number} [delay]
   * @param {{ set: (fn: () => void, ms: number) => unknown, clear: (handle: unknown) => void }} [timers]
   */
  function createDebouncer(callback, delay = DEBOUNCE_MS, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle) }) {
    let handle = null;
    const cancel = () => { if (handle !== null) { timers.clear(handle); handle = null; } };
    return {
      schedule(...args) {
        cancel();
        handle = timers.set(() => { handle = null; callback(...args); }, delay);
      },
      cancel,
      get pending() { return handle !== null; }
    };
  }

  /* ---------------------------------------------------------------- DOM layer */

  const create = (tag, className) => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  };

  /** Slide-in for the logo / title block: travels from the left, fades in. */
  const slideIn = (p) => ({ opacity: String(clamp01(p)), transform: `translate3d(${((1 - p) * -64).toFixed(2)}px, 0, 0)` });

  /** Rise-in for text rows; `index` staggers rows by delaying their share of the shared spring. */
  const riseIn = (index) => (p) => {
    const delay = index * STAGGER_STEP;
    const q = (p - delay) / (1 - delay);
    return { opacity: String(clamp01(q)), transform: `translate3d(0, ${((1 - q) * 22).toFixed(2)}px, 0)` };
  };

  /** One cross-fadable copy of the banner. Two layers alternate so the outgoing text can fade while the incoming one springs in. */
  class HeroLayer {
    constructor(scheduler, assetUrl) {
      this.assetUrl = assetUrl;
      this.root = create('div', 'hero-layer');
      this.identity = create('div', 'hero-identity');
      this.logo = create('img', 'hero-logo');
      this.logo.alt = '';
      this.logo.decoding = 'async';
      this.logo.addEventListener('load', () => this.identity.classList.add('has-logo'));
      this.logo.addEventListener('error', () => { this.identity.classList.remove('has-logo'); this.logo.removeAttribute('src'); });
      this.title = create('h2', 'hero-title');
      this.identity.append(this.logo, this.title);
      this.kicker = create('div', 'hero-kicker');
      this.meta = create('div', 'hero-meta');
      this.description = create('p', 'hero-description');
      this.actions = create('div', 'hero-actions');
      this.cta = create('button', 'hero-cta');
      this.cta.type = 'button';
      this.cta.tabIndex = -1;
      this.offline = create('div', 'hero-offline');
      this.offline.textContent = OFFLINE_NOTICE;
      this.offline.setAttribute('role', 'status');
      this.actions.append(this.cta, this.offline);
      this.root.append(this.kicker, this.identity, this.meta, this.description, this.actions);
      this.retire();
      this.motion = scheduler.create({ p: 0 }, [
        { element: this.kicker, style: riseIn(0) },
        { element: this.identity, style: slideIn },
        { element: this.meta, style: riseIn(2) },
        { element: this.description, style: riseIn(3) },
        { element: this.actions, style: riseIn(4) }
      ], SPRING, () => { if (this.motion.springs.p.target === 0) this.retire(); });
    }

    /** @param {HeroMeta} meta */
    fill(meta) {
      this.root.inert = false;
      this.root.removeAttribute('aria-hidden');
      this.kicker.textContent = meta.kicker;
      this.title.textContent = meta.title;
      this.identity.classList.remove('has-logo');
      if (meta.logo) { this.logo.src = this.assetUrl(meta.logo); } else this.logo.removeAttribute('src');
      this.meta.textContent = [meta.subtitle, meta.playtime].filter(Boolean).join('  ·  ');
      this.meta.hidden = !this.meta.textContent;
      this.description.textContent = meta.description;
      this.description.hidden = !meta.description;
      this.cta.textContent = `▶  ${meta.cta}`;
      this.offline.hidden = !meta.offline;
    }

    /** Drops decoded media and removes the layer from the accessibility tree once it is fully faded out. */
    retire() {
      this.root.inert = true;
      this.root.setAttribute('aria-hidden', 'true');
      this.logo.removeAttribute('src');
      this.identity.classList.remove('has-logo');
    }
  }

  /**
   * Game details banner. Call `show(tile)` on every focus change; the banner debounces rapid scrubbing, skips
   * no-op updates, and cross-fades between two layers with spring-physics slide-ins.
   */
  class HeroBanner {
    /**
     * @param {{
     *   root: HTMLElement, scheduler: { create: Function, setReducedMotion?: Function, dispose?: Function },
     *   assetUrl: (source: string) => string, onPlay?: () => void, delay?: number
     * }} options
     */
    constructor({ root, scheduler, assetUrl, onPlay = () => {}, delay = DEBOUNCE_MS }) {
      this.root = root;
      this.scheduler = scheduler;
      this.layers = [new HeroLayer(scheduler, assetUrl), new HeroLayer(scheduler, assetUrl)];
      this.active = 0;
      this.currentKey = '';
      this.pendingKey = '';
      this.debouncer = createDebouncer((meta) => this.commit(meta), delay);
      root.replaceChildren(...this.layers.map((layer) => layer.root));
      root.addEventListener('click', (event) => { if (event.target.closest('.hero-cta')) onPlay(); });
    }

    /**
     * @param {HeroTile | null | undefined} tile
     * @param {{ recent?: boolean, subtitle?: string }} [context]
     */
    show(tile, context) {
      if (!tile) return;
      const meta = normalizeHeroMeta(tile, context);
      if (meta.key === this.currentKey) { this.debouncer.cancel(); this.pendingKey = ''; return; }
      if (meta.key === this.pendingKey) return;
      if (!this.currentKey) { this.commit(meta); return; }
      this.pendingKey = meta.key;
      this.debouncer.schedule(meta);
    }

    /** @param {HeroMeta} meta */
    commit(meta) {
      this.debouncer.cancel();
      this.pendingKey = '';
      this.currentKey = meta.key;
      const outgoing = this.layers[this.active];
      this.active = 1 - this.active;
      const incoming = this.layers[this.active];
      incoming.fill(meta);
      this.root.dataset.state = 'ready';
      outgoing.motion.to({ p: 0 });
      incoming.motion.to({ p: 1 });
    }

    /** Fades everything out, e.g. when the library is empty. */
    clear() {
      this.debouncer.cancel();
      this.pendingKey = '';
      this.currentKey = '';
      this.layers.forEach((layer) => layer.motion.to({ p: 0 }));
      this.root.dataset.state = 'empty';
    }

    /** Drops any queued update (an external app owns the screen); the next `show` re-evaluates from scratch. */
    suspend() { this.debouncer.cancel(); this.pendingKey = ''; }

    setReducedMotion(reduced) { this.scheduler.setReducedMotion?.(reduced); }

    dispose() {
      this.debouncer.cancel();
      this.layers.forEach((layer) => layer.motion.dispose());
    }
  }

  return { HeroBanner, normalizeHeroMeta, formatPlaytime, createDebouncer, DEBOUNCE_MS, OFFLINE_NOTICE };
});
