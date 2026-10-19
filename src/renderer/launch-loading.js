(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaunchLoading = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Share of the bar filled while waiting for the app window; the rest is filled when the app is ready. */
  const WAITING_CEILING = 0.92;
  /** Time constant of the waiting curve: the bar reaches about two thirds of the ceiling after this long. */
  const TIME_CONSTANT_MS = 1400;
  const FADE_IN_MS = 260;
  const FADE_OUT_MS = 340;

  /**
   * Progress of the bar while the app is loading. Monotonic, never reaches the ceiling by itself, so the bar
   * never claims the app is ready before the main process says so.
   * @param {number} elapsedMs
   * @returns {number} 0..WAITING_CEILING
   */
  function waitingProgress(elapsedMs) {
    const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
    return WAITING_CEILING * (1 - Math.exp(-elapsed / TIME_CONSTANT_MS));
  }

  /**
   * What the card shows for a tile. The logo is the tile's own image when it is an image URL; otherwise the first letter.
   * @param {{ name?: string, title?: string, icon?: string } | null | undefined} tile
   * @returns {{ name: string, initial: string, logo: string }}
   */
  function cardModel(tile) {
    const name = String(tile?.name || tile?.title || 'Starting').trim() || 'Starting';
    const icon = typeof tile?.icon === 'string' ? tile.icon.trim() : '';
    const isImage = /^(data:image\/|file:|https?:|[^:]*\.(png|jpe?g|webp|svg|gif)$)/i.test(icon);
    return { name, initial: name.charAt(0).toUpperCase(), logo: isImage ? icon : '' };
  }

  function reducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** DOM layer: one card, created on first use. Starts at 0 and waits for `ready()`. */
  function createLaunchLoading({ document: doc = (typeof document !== 'undefined' ? document : null), now = () => performance.now(), requestFrame = (fn) => requestAnimationFrame(fn), cancelFrame = (id) => cancelAnimationFrame(id) } = {}) {
    let card = null;
    let bar = null;
    let frame = 0;
    let startedAt = 0;
    let state = 'hidden';
    let hideTimer = 0;

    function ensure() {
      if (card || !doc) return;
      card = doc.createElement('div');
      card.id = 'launch-loading';
      card.className = 'launch-loading';
      card.setAttribute('role', 'status');
      card.setAttribute('aria-live', 'polite');
      card.hidden = true;
      const mark = doc.createElement('div');
      mark.className = 'launch-loading-logo';
      const name = doc.createElement('p');
      name.className = 'launch-loading-name';
      const track = doc.createElement('div');
      track.className = 'launch-loading-track';
      bar = doc.createElement('div');
      bar.className = 'launch-loading-bar';
      track.append(bar);
      card.append(mark, name, track);
      doc.body.append(card);
      card._mark = mark;
      card._name = name;
    }

    function tick() {
      frame = 0;
      if (state !== 'waiting' || !bar) return;
      bar.style.transform = `scaleX(${waitingProgress(now() - startedAt).toFixed(4)})`;
      frame = requestFrame(tick);
    }

    /** Shows the card for a tile: fade in, bar starts from zero. */
    function show(tile) {
      ensure();
      if (!card) return;
      clearTimeout(hideTimer);
      cancelFrame(frame);
      const model = cardModel(tile);
      card._name.textContent = model.name;
      card._mark.textContent = model.logo ? '' : model.initial;
      card._mark.style.backgroundImage = model.logo ? `url("${model.logo.replace(/"/g, '%22')}")` : '';
      card.classList.toggle('has-logo', Boolean(model.logo));
      card.style.transition = reducedMotion() ? 'none' : `opacity ${FADE_IN_MS}ms ease-out`;
      card.hidden = false;
      bar.style.transition = 'none';
      bar.style.transform = 'scaleX(0)';
      void card.offsetWidth;
      card.classList.add('visible');
      state = 'waiting';
      startedAt = now();
      frame = requestFrame(tick);
    }

    /** The app window is visible: fill the bar, then fade the card out. */
    function ready() {
      if (state === 'hidden' || !card) return;
      if (state === 'ready') return;
      state = 'ready';
      cancelFrame(frame);
      frame = 0;
      bar.style.transition = reducedMotion() ? 'none' : 'transform 220ms ease-out';
      bar.style.transform = 'scaleX(1)';
      hideTimer = setTimeout(() => hide(), reducedMotion() ? 0 : 220);
    }

    /** Fades the card out and hides it. Safe to call at any time. */
    function hide() {
      if (!card) return;
      clearTimeout(hideTimer);
      cancelFrame(frame);
      frame = 0;
      state = 'hidden';
      card.style.transition = reducedMotion() ? 'none' : `opacity ${FADE_OUT_MS}ms ease-in`;
      card.classList.remove('visible');
      hideTimer = setTimeout(() => { card.hidden = true; }, reducedMotion() ? 0 : FADE_OUT_MS);
    }

    return { show, ready, hide, get state() { return state; } };
  }

  return { waitingProgress, cardModel, createLaunchLoading, WAITING_CEILING, TIME_CONSTANT_MS };
});
