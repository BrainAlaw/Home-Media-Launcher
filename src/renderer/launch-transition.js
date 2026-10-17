(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaunchTransition = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Launch / close transitions. Only transform and opacity are animated.
   *
   * Launch: a black cover is FLIP-expanded from the focused tile's rectangle to the full viewport while the launcher UI
   * fades and scales out. The launcher stays black until the main process hides it behind the started application.
   * Close: the cover fades away while the UI fades and scales back in, then the originating tile settles with a spring.
   *
   * State machine: idle -> covering -> covered -> revealing -> idle (reveal may interrupt covering).
   */

  const COVER_MS = 460;
  const REVEAL_MS = 420;
  const REDUCED_MS = 160;
  const SPRING = { stiffness: 260, damping: 16, mass: 1 };

  /** Pure transition table; unknown events keep the current state. */
  const TRANSITIONS = {
    idle: { cover: 'covering' },
    covering: { covered: 'covered', reveal: 'revealing' },
    covered: { reveal: 'revealing' },
    revealing: { done: 'idle', cover: 'covering' }
  };
  function nextState(state, event) { return (TRANSITIONS[state] && TRANSITIONS[state][event]) || state; }

  /**
   * FLIP start transform for a full-viewport element (transform-origin 0 0) that should visually begin at `rect`.
   * @param {{ left: number, top: number, width: number, height: number }} rect
   * @param {{ width: number, height: number }} viewport
   */
  function computeFlip(rect, viewport) {
    const width = Math.max(1, viewport.width);
    const height = Math.max(1, viewport.height);
    const sx = Math.min(1, Math.max(0.001, rect.width / width));
    const sy = Math.min(1, Math.max(0.001, rect.height / height));
    return { x: Math.round(rect.left * 100) / 100, y: Math.round(rect.top * 100) / 100, sx, sy, transform: `translate(${rect.left}px, ${rect.top}px) scale(${sx}, ${sy})` };
  }

  /**
   * Samples a damped spring from 0 to 1 until it rests.
   * @returns {{ values: number[], durationMs: number }}
   */
  function springSamples({ stiffness = SPRING.stiffness, damping = SPRING.damping, mass = SPRING.mass } = {}, stepMs = 16, maxMs = 1600) {
    const values = [0];
    let position = 0;
    let velocity = 0;
    let restFor = 0;
    let elapsed = 0;
    const dt = stepMs / 1000;
    while (elapsed < maxMs) {
      velocity += ((-stiffness * (position - 1) - damping * velocity) / mass) * dt;
      position += velocity * dt;
      elapsed += stepMs;
      values.push(position);
      restFor = Math.abs(position - 1) < 0.002 && Math.abs(velocity) < 0.02 ? restFor + 1 : 0;
      if (restFor >= 3) break;
    }
    values[values.length - 1] = 1;
    return { values, durationMs: elapsed };
  }

  /** CSS `linear()` easing approximating the spring, plus the duration it needs. */
  function springEasing(options) {
    const { values, durationMs } = springSamples(options);
    return { easing: `linear(${values.map((value) => Math.round(value * 1000) / 1000).join(', ')})`, durationMs };
  }

  const escapeId = (value) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&'));
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  /**
   * @param {{ document?: Document, isReducedMotion?: () => boolean }} [options]
   */
  function createLaunchTransition({ document: doc = document, isReducedMotion = () => false } = {}) {
    let state = 'idle';
    let cover = null;
    let tint = null;
    let animations = [];
    let coverPromise = Promise.resolve();
    let revealPromise = Promise.resolve();
    let lastTileId = '';

    const send = (event) => { state = nextState(state, event); };

    function ensureCover() {
      if (cover) return cover;
      cover = doc.createElement('div');
      cover.id = 'launch-cover';
      cover.setAttribute('aria-hidden', 'true');
      tint = doc.createElement('div');
      tint.className = 'lt-tint';
      cover.append(tint);
      doc.body.append(cover);
      return cover;
    }

    function cancelAnimations() {
      for (const animation of animations) { try { animation.cancel(); } catch { /* already finished */ } }
      animations = [];
    }

    const track = (animation) => { animations.push(animation); return animation.finished.catch(() => undefined); };

    function settleCoverStyle(visible) {
      cover.style.transform = 'none';
      cover.style.opacity = visible ? '1' : '0';
      cover.style.visibility = visible ? 'visible' : 'hidden';
    }

    return {
      get state() { return state; },
      get lastTileId() { return lastTileId; },

      /** Resolves once the screen is fully black, or immediately when no transition is running. */
      whenCovered() { return state === 'covering' ? coverPromise : Promise.resolve(); },

      /**
       * Expands the cover from `element` to fullscreen. Idempotent while covering/covered.
       * @param {Element | null} element focused tile (null: cover instantly, e.g. launches started elsewhere)
       * @param {{ instant?: boolean }} [options]
       */
      cover(element, { instant = false } = {}) {
        if (state === 'covering' || state === 'covered') return coverPromise;
        cancelAnimations();
        ensureCover();
        send('cover');
        lastTileId = element && element.dataset ? element.dataset.tileId || lastTileId : lastTileId;
        doc.body.classList.remove('lt-revealing');
        doc.body.classList.add('lt-covering');
        const reduced = isReducedMotion();
        cover.style.visibility = 'visible';
        if (instant || (!element && !reduced)) {
          settleCoverStyle(true);
          send('covered');
          coverPromise = Promise.resolve();
          return coverPromise;
        }
        if (reduced) {
          cover.style.transform = 'none';
          const fade = cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: REDUCED_MS, easing: 'linear', fill: 'both' });
          coverPromise = track(fade).then(() => { if (state === 'covering') { settleCoverStyle(true); send('covered'); } });
          return coverPromise;
        }
        const rect = element.getBoundingClientRect();
        const flip = computeFlip(rect, { width: window.innerWidth, height: window.innerHeight });
        cover.style.opacity = '1';
        const grow = cover.animate([{ transform: flip.transform }, { transform: 'translate(0px, 0px) scale(1, 1)' }], {
          duration: COVER_MS, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: 'both'
        });
        const tintFade = tint.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: COVER_MS, easing: 'ease-out', fill: 'both' });
        track(tintFade);
        coverPromise = track(grow).then(() => { if (state === 'covering') { settleCoverStyle(true); cancelAnimations(); send('covered'); } });
        return coverPromise;
      },

      /**
       * Fades the cover away, brings the launcher UI back and settles the originating tile with a spring.
       * Safe to call repeatedly (e.g. launch failure + `idle` phase event).
       */
      reveal(tileId = '') {
        if (state === 'idle' || state === 'revealing') return state === 'revealing' ? revealPromise : Promise.resolve();
        if (tileId) lastTileId = tileId;
        const targetId = lastTileId;
        cancelAnimations();
        send('reveal');
        revealPromise = (async () => {
          // Let the freshly rendered launcher (resumeUi -> render) paint at least once while still hidden behind the cover.
          await nextFrame();
          await nextFrame();
          if (state !== 'revealing') return;
          const reduced = isReducedMotion();
          cover.style.transform = 'none';
          cover.style.visibility = 'visible';
          doc.body.classList.remove('lt-covering');
          doc.body.classList.add('lt-revealing');
          const duration = reduced ? REDUCED_MS : REVEAL_MS;
          const fade = cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' });
          if (!reduced && targetId) this.settleTile(targetId);
          await track(fade);
          if (state !== 'revealing') return;
          settleCoverStyle(false);
          cancelAnimations();
          doc.body.classList.remove('lt-revealing');
          send('done');
        })();
        return revealPromise;
      },

      /** Spring-settles the tile that launched the application (individual `scale` property, so it composes with grid transforms). */
      settleTile(tileId) {
        const element = doc.querySelector(`[data-tile-id="${escapeId(tileId)}"]`);
        if (!element || typeof element.animate !== 'function') return null;
        const supportsLinear = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timing-function', 'linear(0, 1)');
        const { easing, durationMs } = supportsLinear ? springEasing() : { easing: 'cubic-bezier(.34, 1.56, .64, 1)', durationMs: 620 };
        return element.animate([{ scale: '1.14' }, { scale: '1' }], { duration: durationMs, delay: 120, easing, fill: 'backwards' });
      },

      /**
       * Reacts to the main process `phase` event: covers instantly when a session was started elsewhere,
       * keeps the cover during running/closing and reveals when the session ends.
       * @param {{ phase: string, tileId?: string }} phase
       */
      onPhase(phase) {
        if (phase.tileId) lastTileId = phase.tileId;
        if (phase.phase === 'launching' || phase.phase === 'running' || phase.phase === 'closing') {
          if (state === 'idle') this.cover(null, { instant: true });
        } else if (phase.phase === 'idle') void this.reveal(lastTileId);
      }
    };
  }

  return { createLaunchTransition, nextState, computeFlip, springSamples, springEasing, COVER_MS, REVEAL_MS };
});
