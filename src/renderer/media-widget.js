/**
 * Home-screen "now playing" widget (ns `media`, Spotify). Renders into `#media-widget-slot` above the tile rows.
 *
 * Integration (app.js): `MediaWidget.init({...})` once, `setEnabled()` from render(), and while the widget element is
 * the focused element, route every action except `menu` to `handleAction()`. The widget is ONE focus stop of the home
 * navigation; Left/Right move between its buttons internally. Global media keys arrive through the
 * `launcher:remote-action` event of remote-input.js and work without focus.
 *
 * Events:  dispatches `launcher:open-media-view` on `document` (the full music view, M3, listens to it).
 * Motion:  only transform and opacity animate; the glow is a pre-rendered radial gradient whose opacity changes.
 *          Reduced motion and Lite mode switch everything to instant (see media-widget.css).
 */
(function () {
  'use strict';

  const MC = window.MediaControls;
  const SLOT_ID = 'media-widget-slot';
  const TICK_MS = 250;
  const END_REFRESH_DELAY_MS = 900;
  const NEXT_TOAST_WINDOW_MS = 4000;
  const GLOW_FALLBACK = 'var(--accent)';

  const ICONS = Object.freeze({
    prev: '<path d="M6 5h2.4v14H6zM19 5.5v13L9.6 12z" fill="currentColor"/>',
    next: '<path d="M15.6 5H18v14h-2.4zM5 5.5v13L14.4 12z" fill="currentColor"/>',
    play: '<path d="M8 5.2v13.6L19.2 12z" fill="currentColor"/>',
    pause: '<path d="M7 5h3.8v14H7zM13.2 5H17v14h-3.8z" fill="currentColor"/>',
    shuffle: '<path d="M16 4h4v4M4 20 20 4M20 16v4h-4M14.5 14.5 20 20M4 4l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    'volume-down': '<path d="M4 9.5v5h3.6L13 19V5L7.6 9.5z" fill="currentColor"/><path d="M16.2 9.4a3.6 3.6 0 0 1 0 5.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    'volume-up': '<path d="M3 9.5v5h3.6L12 19V5L6.6 9.5z" fill="currentColor"/><path d="M15.2 9.4a3.6 3.6 0 0 1 0 5.2M18.2 6.6a7.6 7.6 0 0 1 0 10.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    library: '<path d="M4 6h11M4 11h7M4 16h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 8v8.2a2.4 2.4 0 1 1-2-2.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    note: '<path d="M9 18V5.5l11-2V16M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  });

  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

  function el(tag, className, attributes) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (attributes) for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  }

  /** Loads the dev-only fake provider when the page URL carries `?media-mock[=scenario]`. */
  function loadMock(scenario) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'media-mock.js';
      script.onload = () => resolve(window.MediaMock.create(scenario));
      script.onerror = () => reject(new Error('media-mock.js missing'));
      document.head.append(script);
    });
  }

  /**
   * @param {{
   *   ext?: { invoke: Function, on: Function },
   *   showToast?: (message: string) => void,
   *   canControl?: () => boolean,
   *   onLeave?: (direction: 'up' | 'down') => void,
   *   requestFocus?: (element: HTMLElement) => void
   * }} options
   */
  function init(options = {}) {
    const showToast = options.showToast || (() => {});
    const canControl = options.canControl || (() => true);
    const onLeave = options.onLeave || (() => {});
    const requestFocus = options.requestFocus || ((node) => node.focus({ preventScroll: true }));
    let ext = options.ext || (window.launcher && window.launcher.ext) || null;

    // The slot normally comes from the home layout (H1); create it before #rows when it is missing.
    let slot = document.getElementById(SLOT_ID);
    if (!slot) {
      slot = el('div');
      slot.id = SLOT_ID;
      const rows = document.getElementById('rows');
      if (rows && rows.parentNode) rows.parentNode.insertBefore(slot, rows);
      else document.body.append(slot);
    }

    const root = el('div', 'mw', { id: 'media-widget', tabindex: '-1', role: 'group', 'aria-label': 'Now playing', 'data-kind': 'signed-out' });
    const glows = el('div', 'mw-glows', { 'aria-hidden': 'true' });
    const glowA = el('div', 'mw-glow');
    const glowB = el('div', 'mw-glow');
    glows.append(glowA, glowB);
    const card = el('div', 'mw-card');
    const art = el('div', 'mw-art');
    art.innerHTML = svg('note');
    const cover = el('img', 'mw-cover', { alt: '', decoding: 'async', draggable: 'false' });
    art.append(cover);
    const text = el('div', 'mw-text');
    const title = el('div', 'mw-title');
    const subtitle = el('div', 'mw-subtitle');
    const progress = el('div', 'mw-progress', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Track progress' });
    const progressFill = el('i');
    progress.append(progressFill);
    text.append(title, subtitle, progress);
    card.append(art, text);
    const ctas = el('div', 'mw-ctas', { role: 'toolbar', 'aria-label': 'Spotify' });
    const controls = el('div', 'mw-controls', { role: 'toolbar', 'aria-label': 'Playback controls' });
    root.append(glows, card, ctas, controls);
    slot.append(root);

    /** @type {Map<string, HTMLButtonElement>} */
    const buttons = new Map();
    const focusModel = new MC.WidgetFocusModel([]);
    // Hidden until app.js reports settings.mediaWidget (avoids a flash of the widget when it is switched off).
    let enabled = false;
    slot.hidden = true;
    let current = MC.normaliseState({ auth: { status: 'signed-out' } });
    let view = MC.buildViewModel(current);
    let lastUpdatedAt = 0;
    let structureKey = '';
    let artUrl = '';
    let artToken = 0;
    let glowSlot = 0;
    let ticker = 0;
    let endRefresh = 0;
    let inside = false;
    let disposed = false;
    let lastFraction = -1;
    /** @type {{ at: number, trackId: string } | null} */
    let pendingTrackToast = null;
    const unsubscribers = [];

    /* -------------------------------------------------------------- rendering */

    function makeButton(id) {
      const button = el('button', `mw-btn mw-${id}`, { type: 'button', tabindex: '-1', 'data-action': id });
      if (id === 'library') button.innerHTML = `${svg('library')}<span class="mw-btn-label">Library</span>`;
      else if (id === 'open-spotify' || id === 'login' || id === 'retry') button.innerHTML = '<span class="mw-btn-label"></span>';
      else if (id === 'repeat') button.innerHTML = `${svg('repeat')}<b class="mw-badge" aria-hidden="true">1</b>`;
      else if (id === 'toggle') button.innerHTML = `${svg('play')}${svg('pause')}`;
      else button.innerHTML = svg(id);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const index = focusModel.order.indexOf(id);
        if (index >= 0) focusModel.index = index;
        requestFocus(root);
        paintActive();
        activate(id);
      });
      return button;
    }

    /** Rebuilds the button DOM only when the set of actions changes (keeps focus memory and transitions stable). */
    function syncStructure() {
      const key = `${view.cardActions.join(',')}|${view.controls.join(',')}`;
      if (key === structureKey) return;
      structureKey = key;
      buttons.clear();
      ctas.replaceChildren();
      controls.replaceChildren();
      for (const id of view.cardActions) { const button = makeButton(id); buttons.set(id, button); ctas.append(button); }
      for (const id of view.controls) {
        const button = makeButton(id);
        buttons.set(id, button);
        controls.append(button);
        if (id === 'volume-down') {
          const level = el('span', 'mw-volume', { 'aria-hidden': 'true' });
          level.append(el('b'), el('i'));
          controls.append(level);
        }
      }
      ctas.hidden = view.cardActions.length === 0;
      controls.hidden = view.controls.length === 0;
      focusModel.setOrder([...view.cardActions, ...view.controls]);
      if (!inside) focusModel.resetToDefault();
    }

    function paintActive() {
      const active = focusModel.current;
      let activeButton = null;
      for (const [id, button] of buttons) {
        const isActive = id === active;
        button.classList.toggle('active', isActive);
        if (isActive) activeButton = button;
      }
      root.dataset.active = active || '';
      root.dataset.zone = view.cardActions.includes(active) ? 'cta' : 'controls';
      if (activeButton) {
        if (!activeButton.id) activeButton.id = `mw-btn-${active}`;
        root.setAttribute('aria-activedescendant', activeButton.id);
      } else root.removeAttribute('aria-activedescendant');
    }

    function paintGlow(url) {
      const token = ++artToken;
      if (!url) { glows.dataset.on = 'false'; return; }
      const probe = new Image();
      probe.crossOrigin = 'anonymous';
      probe.onload = () => {
        if (token !== artToken || disposed) return;
        let colour = null;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 16; canvas.height = 16;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(probe, 0, 0, 16, 16);
          colour = MC.dominantColour(context.getImageData(0, 0, 16, 16).data);
        } catch { /* cross-origin art without CORS headers: use the theme accent */ }
        setGlowColour(MC.glowCss(colour, GLOW_FALLBACK));
      };
      probe.onerror = () => { if (token === artToken) setGlowColour(GLOW_FALLBACK); };
      probe.src = url;
    }

    function setGlowColour(colour) {
      const next = glowSlot === 0 ? glowB : glowA;
      const previous = glowSlot === 0 ? glowA : glowB;
      next.style.setProperty('--mw-glow-colour', colour);
      next.classList.add('on');
      previous.classList.remove('on');
      glowSlot = glowSlot === 0 ? 1 : 0;
      glows.dataset.on = 'true';
    }

    function paintArt() {
      if (view.artUrl === artUrl) return;
      artUrl = view.artUrl;
      cover.classList.remove('loaded');
      if (artUrl) {
        const url = artUrl;
        cover.onload = () => { if (url === artUrl) cover.classList.add('loaded'); };
        cover.onerror = () => { if (url === artUrl) cover.classList.remove('loaded'); };
        cover.src = url;
      } else cover.removeAttribute('src');
      paintGlow(artUrl);
    }

    function render() {
      view = MC.buildViewModel(current);
      root.dataset.kind = view.kind;
      root.dataset.playing = String(view.kind === 'playing');
      root.dataset.interactive = String(view.interactive);
      title.textContent = view.title;
      subtitle.textContent = view.subtitle;
      subtitle.hidden = !view.subtitle;
      card.title = view.detail || '';
      progress.hidden = !view.hasTrack;
      syncStructure();
      paintArt();
      for (const [id, button] of buttons) {
        const label = MC.actionLabel(id, view);
        button.setAttribute('aria-label', label);
        if (id === 'toggle') button.dataset.state = view.kind === 'playing' ? 'playing' : 'paused';
        if (id === 'shuffle') button.setAttribute('aria-pressed', String(view.shuffle));
        if (id === 'repeat') { button.setAttribute('aria-pressed', String(view.repeat !== 'off')); button.dataset.repeat = view.repeat; }
        const labelNode = button.querySelector('.mw-btn-label');
        if (labelNode && id !== 'library') labelNode.textContent = label;
      }
      const level = controls.querySelector('.mw-volume');
      if (level) {
        level.querySelector('b').textContent = view.volume === null ? '--' : String(view.volume);
        level.querySelector('i').style.transform = `scaleX(${(view.volume ?? 0) / 100})`;
        level.dataset.known = String(view.volume !== null);
      }
      paintActive();
      paintProgress(true);
      updateTicker();
      slot.dataset.kind = view.kind;
    }

    function paintProgress(force = false) {
      if (!view.hasTrack) return;
      const now = Date.now();
      const fraction = MC.progressFraction(current, now);
      if (force || Math.abs(fraction - lastFraction) > 0.0005) {
        lastFraction = fraction;
        progressFill.style.transform = `scaleX(${fraction})`;
        progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
        progress.setAttribute('aria-valuetext', `${MC.formatClock(MC.interpolateProgress(current, now))} of ${MC.formatClock(current.track.durationMs)}`);
      }
      if (MC.reachedTrackEnd(current, now) && !endRefresh) {
        endRefresh = setTimeout(() => { endRefresh = 0; void refresh(); }, END_REFRESH_DELAY_MS);
      }
    }

    function updateTicker() {
      const wanted = enabled && view.kind === 'playing' && !document.hidden;
      if (wanted && !ticker) ticker = setInterval(() => paintProgress(), TICK_MS);
      else if (!wanted && ticker) { clearInterval(ticker); ticker = 0; }
    }

    /* -------------------------------------------------------------- state */

    function ingest(raw) {
      const updatedAt = raw && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
      if (updatedAt && updatedAt < lastUpdatedAt) return; // stale push that crossed a newer one
      if (updatedAt) lastUpdatedAt = updatedAt;
      const previousTrack = current.track && current.track.id;
      current = MC.normaliseState(raw);
      if (pendingTrackToast && Date.now() - pendingTrackToast.at < NEXT_TOAST_WINDOW_MS && current.track && current.track.id !== (pendingTrackToast.trackId || previousTrack)) {
        pendingTrackToast = null;
        showToast(`Now playing: ${current.track.title}${current.track.artists.length ? ` - ${current.track.artists.join(', ')}` : ''}`);
      }
      render();
    }

    function onAuth(auth) {
      if (!auth || typeof auth.status !== 'string') return;
      if (auth.status === 'signed-in') {
        current = MC.normaliseState({ ...current, auth }, Date.now());
        render();
        void refresh();
      } else {
        current = MC.normaliseState({ auth });
        render();
      }
    }

    async function call(method, ...args) {
      if (!ext) throw new Error('Media bridge unavailable');
      const result = await ext.invoke('media', method, ...args);
      // Command-style methods resolve with { ok, error?, code? }; failures become exceptions with a friendly message.
      if (result && typeof result === 'object' && result.ok === false) throw new Error(MC.friendlyCode(result.code, result.error));
      return result;
    }

    async function refresh() {
      if (!enabled || disposed) return;
      try {
        ingest(await call('nowPlaying'));
      } catch (nowPlayingError) {
        try { ingest(await call('status')); }
        catch { ingest({ auth: { status: 'error', message: String(nowPlayingError && nowPlayingError.message || nowPlayingError) } }); }
      }
    }

    function describeFailure(error) {
      return MC.friendlyError(error && error.message ? String(error.message).replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : '');
    }

    /** Sends a playback command with an optimistic local update; failures restore the real state. */
    async function run(command, { toastMessage = '' } = {}) {
      if (!enabled) return;
      if (toastMessage) showToast(toastMessage);
      const before = current;
      if (command === 'next' || command === 'previous') pendingTrackToast = { at: Date.now(), trackId: before.track ? before.track.id : '' };
      current = MC.applyOptimistic(current, command);
      render();
      try {
        await call('control', command);
      } catch (error) {
        pendingTrackToast = null;
        showToast(`Spotify: ${describeFailure(error)}`);
        void refresh();
      }
    }

    async function activate(id) {
      if (!enabled) return;
      try {
        if (id === 'library') openView();
        else if (id === 'login') await call('login');
        else if (id === 'retry') { showToast('Reconnecting to Spotify...'); await refresh(); }
        else if (id === 'open-spotify') { showToast('Opening Spotify...'); await call('openSpotifyApp'); window.setTimeout(() => { void refresh(); }, 2500); }
        else {
          const command = MC.commandFor(id, view);
          if (command) await run(command);
        }
      } catch (error) {
        showToast(`Spotify: ${describeFailure(error)}`);
      }
    }

    function openView() {
      document.dispatchEvent(new CustomEvent('launcher:open-media-view', { detail: { source: 'widget' } }));
    }

    /* -------------------------------------------------------------- input */

    /** @returns {boolean} true when the action was consumed */
    function handleAction(action) {
      const effect = focusModel.handle(action);
      if (effect.type === 'focus') paintActive();
      else if (effect.type === 'activate') void activate(effect.id);
      else if (effect.type === 'leave') onLeave(effect.direction);
      return true;
    }

    root.addEventListener('focus', () => {
      if (inside) return;
      inside = true;
      focusModel.resetToDefault();
      paintActive();
    });
    root.addEventListener('blur', () => { inside = false; });
    card.addEventListener('click', () => { if (view.interactive) requestFocus(root); });

    // Global media keys (Fire TV / Google TV remotes, keyboards with media keys) work without focusing the widget.
    document.addEventListener('launcher:remote-action', (event) => {
      const detail = event.detail || {};
      if (detail.long || !enabled || event.defaultPrevented || !canControl()) return;
      if (current.auth.status !== 'signed-in') return;
      const command = MC.commandForRemoteAction(detail.action, current);
      if (!command) return;
      event.preventDefault();
      const message = MC.toastFor(detail.action, { ...current, playing: command === 'play' });
      void run(command, { toastMessage: message || '' });
    });

    document.addEventListener('visibilitychange', () => { updateTicker(); if (!document.hidden) paintProgress(true); });

    /* -------------------------------------------------------------- lifecycle */

    function subscribe() {
      if (!ext) return;
      for (const [name, handler] of [['state', ingest], ['auth', onAuth]]) {
        try {
          const off = ext.on('media', name, handler);
          if (typeof off === 'function') unsubscribers.push(off);
        } catch { /* namespace not available yet */ }
      }
    }

    const params = new URLSearchParams(location.search);
    const boot = params.has('media-mock')
      ? loadMock(params.get('media-mock') || 'playing').then((mock) => { ext = mock.ext; window.__mediaMock = mock; })
      : Promise.resolve();
    boot.catch((error) => console.warn('Media mock unavailable:', error.message)).then(() => {
      if (disposed) return;
      subscribe();
      render();
      void refresh();
    });

    render();

    return {
      element: root,
      /** Hides the widget and reserves no space when disabled (settings.mediaWidget === false). */
      setEnabled(value) {
        const next = value !== false;
        const turnedOn = next && !enabled;
        enabled = next;
        slot.hidden = !enabled;
        updateTicker();
        if (turnedOn && !disposed) void refresh();
      },
      /** True when the widget can take focus right now. */
      canFocus: () => enabled && !slot.hidden && view.interactive,
      owns: (node) => node === root,
      handleAction,
      openView,
      /** Test hook: current view model. */
      get view() { return view; },
      dispose() {
        disposed = true;
        clearInterval(ticker); clearTimeout(endRefresh);
        for (const off of unsubscribers) off();
        slot.removeChild(root);
      }
    };
  }

  window.MediaWidget = {
    init,
    /** Opens the full music view (M3 listens to `launcher:open-media-view`). Usable without an initialised widget. */
    openView() { document.dispatchEvent(new CustomEvent('launcher:open-media-view', { detail: { source: 'api' } })); }
  };
})();
