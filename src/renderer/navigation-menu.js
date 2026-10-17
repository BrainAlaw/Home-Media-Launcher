(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./menu-motion'));
  else root.NavigationMenu = factory(root.MenuMotion);
})(typeof self !== 'undefined' ? self : this, function (MotionModule) {
  'use strict';

  const { CompositorScheduler } = MotionModule;

  const DEFAULT_ITEMS = [
    { id: 'home', label: 'Home', action: 'home' },
    { id: 'library', label: 'Library', action: 'library' },
    { id: 'settings', label: 'Settings', action: 'settings' }
  ];
  const SYMBOLS = {
    home: ['M3 10.5 12 3l9 7.5', 'M5.5 9v12h5v-7h3v7h5V9'],
    library: ['M4 4h5v16H4z', 'M12 4h3v16h-3z', 'm18 4 3 15'],
    settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'm9 3-.6 2.2-2 .9-2-.6-1.8 3.1 1.6 1.6v2.4l-1.6 1.6 1.8 3.1 2-.6 2 .9L9 21h3l.6-2.2 2-.9 2 .6 1.8-3.1-1.6-1.6v-2.4L18.4 8l-1.8-3.1-2 .6-2-.9L12 3Z'],
    category: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z']
  };

  function resolveItems(definition) {
    const items = definition?.groups?.flatMap((group) => group.items.filter((item) => item.visible !== false)) || DEFAULT_ITEMS;
    return items.length ? items : DEFAULT_ITEMS;
  }

  /** Filtering changes membership only; tile rendering and tile styles remain untouched. */
  function matchesCategory(tile, category) {
    const key = String(category || '').trim().toLowerCase();
    const isWeb = tile.type === 'website';
    const isGame = !isWeb && (tile.provider === 'remote' || tile.remote || /moonlight/i.test(String(tile.command || '').split(/[\\/]/).pop()));
    if (['game', 'games', 'moonlight games'].includes(key)) return isGame;
    if (['app', 'apps', 'applications'].includes(key)) return !isWeb && !isGame;
    if (['web', 'web apps', 'websites'].includes(key)) return isWeb;
    return String(tile.category || '').toLowerCase() === key;
  }

  function symbol(action) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of SYMBOLS[action] || SYMBOLS.category) {
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path);
    }
    return svg;
  }

  /** Shares the same spring engine between the tab bar, utility button and quick-settings sheet. */
  class MenuController {
    constructor({ element, panel, systemButton, onSelect, onFocus }) {
      this.element = element; this.panel = panel; this.systemButton = systemButton;
      this.onSelect = onSelect; this.onFocus = onFocus;
      this.query = matchMedia('(prefers-reduced-motion: reduce)');
      this.motion = new CompositorScheduler({ reducedMotion: this.query.matches });
      this.abort = new AbortController();
      this.items = []; this.buttons = []; this.itemMotions = new Map(); this.rects = new Map();
      this.selectedId = null; this.focusedIndex = 0; this.signature = ''; this.dwell = null; this.open = false; this.returning = false;
      this.lens = document.createElement('span'); this.lens.className = 'navigation-lens'; this.lens.setAttribute('aria-hidden', 'true');
      this.tabs = document.createElement('div'); this.tabs.className = 'navigation-tabs'; this.tabs.setAttribute('role', 'tablist'); this.tabs.setAttribute('aria-label', 'Library sections');
      element.append(this.lens, this.tabs);
      this.lensMotion = this.motion.create({ x: 0, y: 8, width: 1, height: 1 }, [{ element: this.lens,
        style: (state) => ({ transform: `translate3d(${state.x}px,${state.y}px,0) scale3d(${state.width},${state.height},1)` }) }]);
      this.panelLens = document.createElement('span'); this.panelLens.className = 'system-focus-lens'; this.panelLens.setAttribute('aria-hidden', 'true');
      panel.querySelector('.menu-items').prepend(this.panelLens);
      this.panelLensMotion = this.motion.create({ y: 0, height: 1 }, [{ element: this.panelLens,
        style: (state) => ({ transform: `translate3d(0,${state.y}px,0) scaleY(${state.height})` }) }]);
      this.panelMotion = this.motion.create({ open: 0 }, [{ element: panel, style: (state) => ({
        opacity: String(Math.max(0, Math.min(1, state.open))),
        transform: `translate3d(${(1 - state.open) * 22}px,${(1 - state.open) * -8}px,0) scale(${0.96 + state.open * 0.04})`
      }) }], { stiffness: 360, damping: 32 }, () => { if (!this.open) { panel.hidden = true; panel.classList.remove('open'); } });
      this.systemMotion = this.motion.create({ scale: 1 }, [{ element: systemButton, style: (state) => ({ transform: `translate3d(0,0,0) scale(${state.scale})` }) }]);
      this.listen(systemButton, 'focus', () => this.systemMotion.to({ scale: 1.1 }));
      this.listen(systemButton, 'blur', () => this.systemMotion.to({ scale: 1 }));
      this.listen(element, 'focusin', (event) => this.focused(this.buttons.indexOf(event.target.closest('[data-menu-id]'))));
      this.listen(element, 'focusout', (event) => {
        if (element.contains(event.relatedTarget)) return;
        clearTimeout(this.dwell); this.element.dataset.engaged = 'false';
        this.updateSelection();
        this.buttons.forEach((button) => { button.dataset.focused = 'false'; this.itemMotions.get(button)?.to({ focus: 0, x: 0, y: 0 }); });
        this.moveLens(this.buttons.find((button) => button.dataset.menuId === this.selectedId));
      });
      this.listen(panel, 'focusin', (event) => this.focusPanel(event.target.closest('.menu-action')));
      this.listen(panel, 'focusout', (event) => { if (!panel.contains(event.relatedTarget)) this.clearPanelFocus(); });
      this.listen(this.query, 'change', (event) => { this.motion.setReducedMotion(event.matches); });
      this.resize = new ResizeObserver(() => this.measure());
      this.resize.observe(element); this.resize.observe(panel);
      this.listen(window, 'blur', () => { clearTimeout(this.dwell); });
      for (const action of panel.querySelectorAll('.menu-action')) {
        this.track(action);
        this.listen(action, 'pointermove', (event) => {
          if (!this.open || event.pointerType !== 'mouse' || !(event.movementX || event.movementY)) return;
          (action.querySelector('input') || action).focus({ preventScroll: true });
        });
      }
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

    setItems(definition) {
      const items = resolveItems(definition);
      const signature = JSON.stringify(items);
      if (signature === this.signature) return;
      clearTimeout(this.dwell); this.signature = signature; this.items = items;
      for (const button of this.buttons) { this.itemMotions.get(button)?.dispose(); this.itemMotions.delete(button); }
      this.tabs.replaceChildren();
      for (const action of this.element.querySelectorAll('.navigation-action')) action.remove();
      this.buttons = items.map((item) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'navigation-tab';
        button.dataset.menuId = item.id; button.id = `navigation-${item.id}`; button.tabIndex = -1;
        const content = document.createElement('span'); content.className = 'menu-content';
        const label = document.createElement('span'); label.textContent = item.label;
        content.append(symbol(item.action), label); button.append(content);
        if (item.action === 'settings') { button.classList.add('navigation-action'); this.element.append(button); }
        else { button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'rows'); this.tabs.append(button); }
        this.track(button);
        this.listen(button, 'click', () => { this.onFocus(button); this.commit(item, true); });
        this.listen(button, 'pointermove', (event) => {
          if (event.pointerType === 'mouse' && (event.movementX || event.movementY) && document.activeElement !== button) { this.onFocus(button); button.focus({ preventScroll: true }); }
        });
        return button;
      });
      if (!items.some((item) => item.id === this.selectedId && item.action !== 'settings')) this.selectedId = items.find((item) => item.action !== 'settings')?.id || null;
      this.focusedIndex = Math.max(0, items.findIndex((item) => item.id === this.selectedId));
      this.updateSelection(); this.measure(true);
    }

    updateSelection() {
      for (const button of this.buttons) {
        const selected = button.dataset.menuId === this.selectedId;
        if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected || (!this.selectedId && button === this.buttons[0]) ? 0 : -1;
      }
      const selected = this.buttons.find((button) => button.dataset.menuId === this.selectedId);
      if (selected) document.querySelector('#rows').setAttribute('aria-labelledby', selected.id);
    }

    measure(snap = false) {
      this.viewportWidth = this.element.clientWidth;
      for (const button of this.buttons) this.rects.set(button, { x: button.offsetLeft, y: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight });
      this.moveLens(this.element.contains(document.activeElement) ? this.buttons[this.focusedIndex] : this.buttons.find((button) => button.dataset.menuId === this.selectedId), snap);
      if (this.open) this.focusPanel(this.panel.querySelector('.menu-action[data-focused="true"]'));
    }

    moveLens(button, snap = false) {
      const rect = this.rects.get(button);
      if (!rect || !rect.width) return;
      const target = { x: rect.x, y: rect.y, width: rect.width / 100, height: rect.height / 48 };
      if (snap || this.query.matches) this.lensMotion.snap(target); else this.lensMotion.to(target);
    }

    focused(index, direction = 0) {
      if (index < 0) return;
      clearTimeout(this.dwell);
      const previous = this.focusedIndex; this.focusedIndex = index;
      this.element.dataset.engaged = 'true';
      this.buttons.forEach((button, i) => {
        button.tabIndex = i === index ? 0 : -1;
        button.dataset.focused = String(i === index);
        this.itemMotions.get(button)?.to({ focus: i === index ? 1 : 0, x: 0, y: 0 }, i === index ? { x: (direction || Math.sign(index - previous)) * 42 } : {});
      });
      this.moveLens(this.buttons[index]);
      const rect = this.rects.get(this.buttons[index]);
      if (rect) {
        if (rect.x < this.element.scrollLeft + 8) this.element.scrollLeft = Math.max(0, rect.x - 8);
        else if (rect.x + rect.width > this.element.scrollLeft + this.viewportWidth - 8) this.element.scrollLeft = rect.x + rect.width - this.viewportWidth + 8;
      }
      this.onFocus(this.buttons[index]);
      if (this.items[index]?.action !== 'settings') this.dwell = setTimeout(() => this.commit(this.items[index]), 160);
    }

    commit(item, explicit = false) {
      clearTimeout(this.dwell);
      if (!item || (item.action === 'settings' && !explicit)) return;
      if (explicit) {
        const motion = this.itemMotions.get(this.buttons[this.items.indexOf(item)]);
        motion?.to({ press: 0 }, { press: 12 });
      }
      if (item.action !== 'settings') {
        if (this.selectedId === item.id) return;
        this.selectedId = item.id; this.updateSelection();
      }
      this.onSelect(item);
    }

    commitFocused() { this.commit(this.items[this.focusedIndex]); }
    focusSelected() { (this.buttons.find((button) => button.dataset.menuId === this.selectedId) || this.buttons[0])?.focus({ preventScroll: true }); }
    move(direction) {
      const sign = direction === 'left' ? -1 : 1;
      const index = Math.max(0, Math.min(this.focusedIndex + sign, this.buttons.length - 1));
      if (index === this.focusedIndex) this.itemMotions.get(this.buttons[index])?.to({ x: 0 }, { x: sign * 48 });
      else this.buttons[index]?.focus({ preventScroll: true });
    }

    clearPanelFocus() {
      for (const action of this.panel.querySelectorAll('.menu-action')) { action.dataset.focused = 'false'; this.itemMotions.get(action)?.to({ focus: 0, x: 0, y: 0 }); }
    }

    focusPanel(action) {
      if (!action) return;
      let direction = 0;
      const previous = this.panel.querySelector('.menu-action[data-focused="true"]');
      if (previous) direction = Math.sign(action.offsetTop - previous.offsetTop);
      this.clearPanelFocus(); action.dataset.focused = 'true';
      this.itemMotions.get(action)?.to({ focus: 1, x: 0, y: 0 }, { y: direction * 36 });
      this.panelLensMotion.to({ y: action.offsetTop, height: action.offsetHeight / 64 });
    }

    setOpen(open) {
      this.open = open;
      this.panel.inert = !open; this.panel.setAttribute('aria-hidden', String(!open));
      document.querySelector('main').inert = open;
      if (open) { this.panel.hidden = false; this.panel.classList.add('open'); }
      else this.clearPanelFocus();
      this.panelMotion.to({ open: open ? 1 : 0 });
    }

    dispose() { clearTimeout(this.dwell); this.abort.abort(); this.resize.disconnect(); this.motion.dispose(); }
  }

  return { MenuController, resolveItems, matchesCategory };
});
