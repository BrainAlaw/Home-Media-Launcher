(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./menu-motion'));
  else root.NavigationMenu = factory(root.MenuMotion);
})(typeof self !== 'undefined' ? self : this, function (MotionModule) {
  'use strict';

  const { CompositorScheduler } = MotionModule;

  /**
   * Shares the spring engine between the header quick-settings button and the quick-settings sheet.
   * The former top navigation bar (Home / Library / Settings) is gone; Settings lives in the sheet.
   */
  class MenuController {
    constructor({ panel, systemButton }) {
      this.panel = panel; this.systemButton = systemButton;
      this.query = matchMedia('(prefers-reduced-motion: reduce)');
      this.motion = new CompositorScheduler({ reducedMotion: this.query.matches });
      this.abort = new AbortController();
      this.itemMotions = new Map(); this.open = false;
      this.panelLens = document.createElement('span'); this.panelLens.className = 'system-focus-lens'; this.panelLens.setAttribute('aria-hidden', 'true');
      panel.querySelector('.menu-items').prepend(this.panelLens);
      this.panelLensMotion = this.motion.create({ y: 0, height: 1 }, [{ element: this.panelLens,
        style: (state) => ({ transform: `translate3d(0,${state.y}px,0) scaleY(${state.height})` }) }]);
      this.panelMotion = this.motion.create({ open: 0 }, [{ element: panel, style: (state) => ({
        opacity: String(Math.max(0, Math.min(1, state.open))),
        transform: `translate3d(${(1 - state.open) * 22}px,${(1 - state.open) * -8}px,0) scale(${0.96 + state.open * 0.04})`
      }) }], { stiffness: 360, damping: 32 }, () => { delete panel.dataset.animating; if (!this.open) { panel.hidden = true; panel.classList.remove('open'); } });
      // The header button is styled purely by CSS states (rest / focus / aria-expanded) in menu.css.
      // Focus on something that is not a row (the speed test button in the Ethernet card) clears the row highlight, so the previous row does not stay lit.
      this.listen(panel, 'focusin', (event) => {
        const action = event.target.closest('.menu-action');
        if (action) this.focusPanel(action); else this.clearPanelFocus();
      });
      this.listen(panel, 'focusout', (event) => { if (!panel.contains(event.relatedTarget)) this.clearPanelFocus(); });
      this.listen(this.query, 'change', (event) => { this.motion.setReducedMotion(event.matches); });
      this.resize = new ResizeObserver(() => this.measure());
      this.resize.observe(panel);
      for (const action of panel.querySelectorAll('.menu-action')) this.register(action);
      // Rows added later (VPN providers) are registered as they appear, so every row shares the same inline motion.
      this.rowObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches('.menu-action')) this.register(node);
            for (const action of node.querySelectorAll('.menu-action')) this.register(action);
          }
        }
      });
      this.rowObserver.observe(panel, { childList: true, subtree: true });
    }

    /** Gives a row the shared spring motion and hover focus. Idempotent, so rows created later (VPN providers) behave like the static ones. */
    register(action) {
      if (this.itemMotions.has(action)) return;
      this.track(action);
      this.listen(action, 'pointermove', (event) => {
        if (!this.open || event.pointerType !== 'mouse' || !(event.movementX || event.movementY)) return;
        action.focus({ preventScroll: true });
      });
    }

    listen(element, type, callback) { element.addEventListener(type, callback, { signal: this.abort.signal }); }

    track(button) {
      const content = button.querySelector('.menu-content, .menu-copy');
      const icon = button.querySelector('.menu-symbol');
      const bindings = [{ element: button, style: (state) => ({ transform: `translate3d(0,0,0) scale(${1 + state.focus * 0.045 - state.press * 0.035})` }) }];
      if (content) bindings.push({ element: content, style: (state) => ({ transform: `translate3d(${state.x}px,${state.y}px,0) rotateX(${-state.y * 0.25}deg) rotateY(${state.x * 0.25}deg)` }) });
      if (icon) bindings.push({ element: icon, style: (state) => ({ transform: `translate3d(${state.x * 1.4}px,${state.y * 1.4}px,0)` }) });
      const motion = this.motion.create({ focus: 0, press: 0, x: 0, y: 0 }, bindings);
      this.itemMotions.set(button, motion);
      this.listen(button, 'pointerdown', () => motion.to({ press: 1 }));
      this.listen(button, 'pointerup', () => motion.to({ press: 0 }));
      this.listen(button, 'pointerleave', () => motion.to({ press: 0, x: 0, y: 0 }));
      this.listen(button, 'pointercancel', () => motion.to({ press: 0, x: 0, y: 0 }));
      return motion;
    }

    measure() {
      if (this.open) this.focusPanel(this.panel.querySelector('.menu-action[data-focused="true"]'));
    }

    clearPanelFocus() {
      for (const action of this.panel.querySelectorAll('.menu-action')) { action.dataset.focused = 'false'; this.itemMotions.get(action)?.to({ focus: 0, x: 0, y: 0 }); }
    }

    focusPanel(action) {
      if (!action) return;
      this.register(action);
      let direction = 0;
      const previous = this.panel.querySelector('.menu-action[data-focused="true"]');
      if (previous) direction = Math.sign(action.offsetTop - previous.offsetTop);
      this.clearPanelFocus(); action.dataset.focused = 'true';
      this.itemMotions.get(action)?.to({ focus: 1, x: 0, y: 0 }, { y: direction * 36 });
      this.panelLensMotion.to({ y: action.offsetTop, height: action.offsetHeight / (this.panelLens.offsetHeight || 64) });
    }

    setOpen(open) {
      this.open = open;
      this.panel.inert = !open; this.panel.setAttribute('aria-hidden', String(!open));
      document.querySelector('main').inert = open;
      // Only one blurred surface at a time: perf.css drops the bar blur while the sheet is open, and will-change lives only for the animation.
      document.body.classList.toggle('menu-open', open);
      this.panel.dataset.animating = 'true';
      if (open) { this.panel.hidden = false; this.panel.classList.add('open'); }
      else this.clearPanelFocus();
      this.panelMotion.to({ open: open ? 1 : 0 });
    }

    dispose() { this.abort.abort(); this.resize.disconnect(); this.rowObserver.disconnect(); this.motion.dispose(); }
  }

  return { MenuController };
});
