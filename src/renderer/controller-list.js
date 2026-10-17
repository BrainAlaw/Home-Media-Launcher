'use strict';

/**
 * Connected-controller list. Rows are keyed by controller id and updated in place, so periodic refreshes never
 * replay entrance animations or drop gamepad focus. Focus and press feedback use the shared spring scheduler.
 */
window.ControllerList = (function () {
  const { TRANSPORT_LABELS, transportIcon, batteryGauge, controllerGraphic } = window.ControllerIcons;
  const SPRING = { stiffness: 380, damping: 22 };
  const ENTRANCE_STAGGER_MS = 55;

  class ControllerList {
    /** @param {{ container: HTMLElement, scheduler: any }} options */
    constructor({ container, scheduler }) {
      this.container = container;
      this.scheduler = scheduler;
      /** @type {Map<string, { element: HTMLButtonElement, motion: any }>} */
      this.rows = new Map();
      this.placeholder = null;
      this.timers = new Set();
    }

    /** @param {import('./controller-service').Controller[]} controllers */
    render(controllers) {
      this.clearPlaceholder();
      const seen = new Set();
      controllers.forEach((controller, index) => {
        seen.add(controller.id);
        const existing = this.rows.get(controller.id);
        if (existing) this.fill(existing.element, controller);
        else this.add(controller, index);
      });
      for (const [id, row] of [...this.rows]) {
        if (seen.has(id)) continue;
        row.motion.dispose();
        row.element.remove();
        this.rows.delete(id);
      }
      // Keep DOM order identical to the backend order without recreating nodes.
      controllers.forEach((controller) => this.container.append(this.rows.get(controller.id).element));
      if (!controllers.length) this.showEmpty();
    }

    showLoading() {
      if (this.rows.size) return;
      this.setPlaceholder('Checking controllers…');
    }

    /** @param {string} message */
    showError(message) {
      this.rows.forEach((row) => { row.motion.dispose(); row.element.remove(); });
      this.rows.clear();
      this.setPlaceholder(message, 'error');
    }

    showEmpty() {
      this.clearPlaceholder();
      const empty = document.createElement('div');
      empty.className = 'device-empty';
      const art = controllerGraphic('unknown');
      art.classList.add('cg-idle');
      const title = document.createElement('strong');
      title.textContent = 'No controllers connected';
      const hint = document.createElement('span');
      hint.textContent = 'Pair an Xbox controller to play with a gamepad.';
      empty.append(art, title, hint);
      this.container.append(empty);
      this.placeholder = empty;
    }

    setPlaceholder(message, state = '') {
      this.clearPlaceholder();
      const note = document.createElement('p');
      note.className = 'device-note';
      note.dataset.state = state;
      note.textContent = message;
      this.container.append(note);
      this.placeholder = note;
    }

    clearPlaceholder() {
      this.placeholder?.remove();
      this.placeholder = null;
    }

    /** @param {import('./controller-service').Controller} controller @param {number} index */
    add(controller, index) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'device-row';
      element.dataset.controllerId = controller.id;
      const motion = this.scheduler.create({ scale: 0.96, y: 18, o: 0 }, (v) => {
        element.style.transform = `translate3d(0, ${v.y.toFixed(2)}px, 0) scale(${v.scale.toFixed(4)})`;
        element.style.opacity = String(Math.max(0, Math.min(1, v.o)));
      }, SPRING);
      this.rows.set(controller.id, { element, motion });
      this.fill(element, controller);
      this.container.append(element);

      const settle = () => motion.to({ scale: 1, y: 0, o: 1 });
      const timer = setTimeout(() => { this.timers.delete(timer); settle(); }, index * ENTRANCE_STAGGER_MS);
      this.timers.add(timer);
      element.addEventListener('focus', () => motion.to({ scale: 1.03, y: -2, o: 1 }));
      element.addEventListener('blur', () => motion.to({ scale: 1, y: 0, o: 1 }));
      // Tactile press: kick the spring so the row bounces back.
      element.addEventListener('click', () => motion.to({ scale: 1.03, y: -2, o: 1 }, { scale: -1.6 }));
    }

    /** @param {HTMLElement} element @param {import('./controller-service').Controller} controller */
    fill(element, controller) {
      const label = TRANSPORT_LABELS[controller.transport] || TRANSPORT_LABELS.unknown;
      const low = Number.isFinite(controller.battery) && controller.battery <= 15 && !controller.charging;
      const icon = document.createElement('span');
      icon.className = 'device-icon';
      icon.append(transportIcon(controller.transport));
      const text = document.createElement('span');
      text.className = 'device-text';
      const name = document.createElement('strong');
      name.textContent = controller.name;
      const meta = document.createElement('span');
      meta.textContent = `${label} · ${controller.charging ? 'Charging' : low ? 'Battery low' : 'Connected'}`;
      meta.dataset.state = low ? 'warn' : '';
      text.append(name, meta);
      element.replaceChildren(icon, text, batteryGauge(controller.battery, controller.charging));
      element.setAttribute('aria-label', `${controller.name}, ${label}, ${Number.isFinite(controller.battery) ? `${controller.battery} percent battery` : 'battery unavailable'}`);
    }

    dispose() {
      this.timers.forEach((timer) => clearTimeout(timer));
      this.timers.clear();
      this.rows.forEach((row) => row.motion.dispose());
      this.rows.clear();
    }
  }

  return ControllerList;
})();
