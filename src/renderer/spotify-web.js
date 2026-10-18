/**
 * Spotify web player as a panel inside the home screen (ns `spotifyweb`). Opening it slides the tile rows down and
 * grows a stage below the header; the main process places a native web view exactly over that stage.
 * Input while open belongs to the page (spotify-web-preload.js); this module only reacts to the page leaving,
 * and forwards a stray Back (launcher focused) to the page's history.
 */
(function () {
  'use strict';

  const PANEL_ID = 'spotify-web-panel';
  const GAP_PX = 16;
  /** Matches the CSS transition on #grid-content / the panel; the native view appears once the stage stopped moving. */
  const SETTLE_MS = 520;

  let panel = null;
  let stage = null;
  let open = false;
  let attached = false;
  let settleTimer = 0;
  let observer = null;
  let onClose = null;
  let unsubscribe = null;

  const ext = () => window.launcher?.ext;

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Spotify web player');
    panel.hidden = true;
    stage = document.createElement('div');
    stage.className = 'sw-stage';
    const hint = document.createElement('div');
    hint.className = 'sw-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = 'D-pad Move · A Select · B Back · LB/RB Scroll';
    const loading = document.createElement('div');
    loading.className = 'sw-loading';
    loading.textContent = 'Opening Spotify…';
    panel.append(stage, loading, hint);
    document.getElementById('rows')?.append(panel);
  }

  /** The media strip lives in the header, above the rows viewport. */
  function placePanel() {
    const slot = document.getElementById('media-widget-slot');
    const rows = document.getElementById('rows');
    const slotRect = slot && !slot.hidden ? slot.getBoundingClientRect() : null;
    const rowsRect = rows?.getBoundingClientRect();
    const bottom = slotRect?.height && rowsRect ? Math.max(0, slotRect.bottom - rowsRect.top) : 0;
    panel.style.setProperty('--sw-top', `${bottom + GAP_PX}px`);
  }

  function stageBounds() {
    const rect = stage.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }

  async function attach() {
    if (!open || attached) return;
    try {
      const result = await ext().invoke('spotifyweb', 'open', stageBounds());
      if (!result?.ok) throw new Error(result?.error || 'Unavailable');
      if (!open) { void ext().invoke('spotifyweb', 'close').catch(() => {}); return; }
      attached = true;
      panel.dataset.state = 'ready';
      observer = new ResizeObserver(() => { if (attached) void ext().invoke('spotifyweb', 'setBounds', stageBounds()); });
      observer.observe(stage);
    } catch (error) {
      panel.dataset.state = 'error';
      panel.querySelector('.sw-loading').textContent = `Spotify web is unavailable: ${error.message}`;
    }
  }

  /** @param {{ onClose?: () => void }} [options] */
  function show(options = {}) {
    if (open || !ext()) return false;
    ensurePanel();
    open = true;
    onClose = options.onClose || null;
    placePanel();
    panel.hidden = false;
    panel.dataset.state = 'loading';
    panel.querySelector('.sw-loading').textContent = 'Opening Spotify…';
    window.MediaWidget?.setSpotifyWebOpen(true);
    unsubscribe = ext().on('spotifyweb', 'closed', () => hide());
    // Two frames: the panel must be laid out before the slide-in transition starts.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!open) return;
      document.body.classList.add('sw-open');
      placePanel();
      document.getElementById('grid-content')?.setAttribute('inert', '');
    }));
    settleTimer = window.setTimeout(attach, SETTLE_MS);
    return true;
  }

  function toggle(options = {}) {
    if (open) { hide(); return true; }
    return show(options);
  }

  function hide() {
    if (!open) return;
    open = false;
    clearTimeout(settleTimer);
    observer?.disconnect();
    observer = null;
    if (typeof unsubscribe === 'function') unsubscribe();
    unsubscribe = null;
    if (attached) void ext().invoke('spotifyweb', 'close').catch(() => {});
    attached = false;
    document.body.classList.remove('sw-open');
    const grid = document.getElementById('grid-content');
    grid?.removeAttribute('inert');
    window.MediaWidget?.setSpotifyWebOpen(false);
    if (grid) {
      grid.style.removeProperty('transform');
      grid.style.removeProperty('opacity');
      grid.style.removeProperty('visibility');
      grid.style.removeProperty('pointer-events');
    }
    window.setTimeout(() => { if (!open && panel) panel.hidden = true; }, SETTLE_MS);
    const callback = onClose;
    onClose = null;
    callback?.();
  }

  /** The launcher only sees input when it holds focus; Back then steps through the page history, anything else returns focus. */
  function handleAction(action) {
    if (!open || !attached) { if (action === 'back') hide(); return; }
    if (document.hasFocus()) {
      void ext().invoke('spotifyweb', action === 'back' ? 'back' : 'focus').catch(() => {});
    }
  }

  window.addEventListener('resize', () => {
    if (!open) return;
    placePanel();
    if (attached) void ext().invoke('spotifyweb', 'setBounds', stageBounds());
  });

  window.SpotifyWeb = { show, hide, toggle, handleAction, get isOpen() { return open; } };
})();
