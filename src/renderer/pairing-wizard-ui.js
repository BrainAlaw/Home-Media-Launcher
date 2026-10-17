'use strict';

/**
 * Pairing wizard view. Renders PairingFlow state into a modal <dialog>:
 * instructions -> scanning -> success | error. Panels slide with spring physics, the success mark pops with
 * overshoot and the error mark shakes. All input is routed through handleAction() so keyboard and gamepad work.
 */
window.PairingWizardUI = (function () {
  const { TRANSPORT_LABELS, controllerGraphic, scanner, resultMark } = window.ControllerIcons;
  const { findNext, toRect } = window.SpatialNav;

  const STEP_INDEX = { instructions: 0, scanning: 1, success: 2, error: 2 };
  const PANEL_SPRING = { stiffness: 300, damping: 26 };
  const PANEL_TRAVEL = 56;
  const PANEL_EXIT_MS = 300;

  const INSTRUCTIONS = {
    bluetooth: 'Turn the controller on, then press and hold the small Pair button on top, between the bumpers, until the Xbox button flashes quickly. VibePollo does the rest, no terminal needed.',
    dongle: 'Plug in the Microsoft Wireless Adapter and press its button until the light blinks. Then hold the Pair button on the controller until the Xbox button flashes.',
    usb: 'Connect the controller with a USB data cable. It will be detected automatically.'
  };

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  class PairingWizardUI {
    /**
     * @param {{ dialog: HTMLDialogElement, flow: import('./pairing-flow').PairingFlow, scheduler: any, onClosed: () => void }} options
     */
    constructor({ dialog, flow, scheduler, onClosed }) {
      this.dialog = dialog;
      this.flow = flow;
      this.scheduler = scheduler;
      this.onClosed = onClosed;
      this.current = null;
      this.timers = new Set();

      this.card = node('div', 'wizard-card');
      this.progress = node('div', 'wizard-progress');
      this.progress.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 3; index += 1) this.progress.append(node('span', 'wizard-dot'));
      this.stage = node('div', 'wizard-stage');
      this.stage.setAttribute('aria-live', 'polite');
      this.card.append(this.progress, this.stage);
      dialog.replaceChildren(this.card);

      dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.flow.cancel(); });
      flow.subscribe((state, previous) => this.render(state, previous));
    }

    get isOpen() { return this.dialog.open; }

    open(transport) {
      this.flow.open(transport);
    }

    /** @param {import('./pairing-flow').PairingState} state @param {import('./pairing-flow').PairingState} previous */
    render(state, previous) {
      if (state.step === 'closed') { this.close(); return; }
      if (!this.dialog.open) this.dialog.showModal();
      this.updateProgress(state);
      if (!this.current || previous.step !== state.step) this.show(this.buildPanel(state));
      else this.current.update(state);
    }

    close() {
      this.timers.forEach((timer) => clearTimeout(timer));
      this.timers.clear();
      this.current?.motion.dispose();
      this.current = null;
      this.stage.replaceChildren();
      if (this.dialog.open) this.dialog.close();
      this.onClosed();
    }

    updateProgress(state) {
      const active = STEP_INDEX[state.step];
      this.progress.querySelectorAll('.wizard-dot').forEach((dot, index) => {
        dot.dataset.state = index < active ? 'done' : index === active ? (state.step === 'error' ? 'error' : state.step === 'success' ? 'done' : 'active') : '';
      });
    }

    /** Slides the new panel in and the old one out. */
    show(panel) {
      const previous = this.current;
      this.current = panel;
      this.stage.append(panel.element);
      panel.motion = this.scheduler.create({ x: PANEL_TRAVEL, o: 0, s: 0.97 }, (v) => {
        panel.element.style.transform = `translate3d(${v.x.toFixed(2)}px, 0, 0) scale(${v.s.toFixed(4)})`;
        panel.element.style.opacity = String(Math.max(0, Math.min(1, v.o)));
      }, PANEL_SPRING);
      panel.motion.to({ x: 0, o: 1, s: 1 });
      if (previous) {
        previous.element.inert = true;
        previous.motion.to({ x: -PANEL_TRAVEL, o: 0, s: 0.97 });
        const timer = setTimeout(() => { this.timers.delete(timer); previous.motion.dispose(); previous.element.remove(); }, PANEL_EXIT_MS);
        this.timers.add(timer);
      }
      panel.enter?.();
      const focusTimer = setTimeout(() => { this.timers.delete(focusTimer); this.focusPrimary(); }, 0);
      this.timers.add(focusTimer);
    }

    focusPrimary() {
      const target = this.current?.element.querySelector('[data-primary]') || this.current?.element.querySelector('button');
      target?.focus();
    }

    /** @param {import('./pairing-flow').PairingState} state */
    buildPanel(state) {
      const builders = { instructions: this.instructionsPanel, scanning: this.scanningPanel, success: this.successPanel, error: this.errorPanel };
      return builders[state.step].call(this, state);
    }

    button(label, action, { primary = false } = {}) {
      const button = node('button', primary ? 'primary' : '', label);
      button.type = 'button';
      button.dataset.action = action;
      if (primary) button.dataset.primary = '';
      return button;
    }

    actions(...buttons) {
      const row = node('div', 'wizard-actions');
      row.append(...buttons);
      return row;
    }

    instructionsPanel(state) {
      const element = node('section', 'wizard-panel');
      const art = node('div', 'wizard-art');
      const title = node('h2', '', 'Put your controller in pairing mode');
      const body = node('p');
      const chips = node('div', 'wizard-chips');
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', 'Connection type');
      for (const transport of ['bluetooth', 'dongle', 'usb']) {
        const chip = node('button', 'chip', TRANSPORT_LABELS[transport]);
        chip.type = 'button';
        chip.dataset.transport = transport;
        chip.addEventListener('click', () => this.flow.setTransport(transport));
        chips.append(chip);
      }
      const start = this.button('Start Searching', 'begin', { primary: true });
      start.addEventListener('click', () => this.flow.begin());
      const cancel = this.button('Cancel', 'cancel');
      cancel.addEventListener('click', () => this.flow.cancel());
      element.append(art, title, body, chips, this.actions(start, cancel));

      let rendered = '';
      const update = (next) => {
        if (rendered !== next.transport) {
          rendered = next.transport;
          art.replaceChildren(controllerGraphic(next.transport));
          body.textContent = INSTRUCTIONS[next.transport];
        }
        chips.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', String(chip.dataset.transport === next.transport)));
      };
      update(state);
      return { element, update };
    }

    scanningPanel(state) {
      const element = node('section', 'wizard-panel');
      const art = node('div', 'wizard-art');
      art.append(scanner(state.transport));
      const title = node('h2');
      const body = node('p');
      const cancel = this.button('Cancel', 'cancel', { primary: true });
      cancel.addEventListener('click', () => this.flow.cancel());
      element.append(art, title, body, this.actions(cancel));
      const update = (next) => {
        if (next.phase === 'connecting') {
          title.textContent = `Connecting to ${next.device?.name || 'controller'}…`;
          body.textContent = 'Found it. Keep the controller close while it finishes pairing.';
        } else {
          title.textContent = 'Searching for controllers…';
          body.textContent = 'Keep the controller in pairing mode. This usually takes a few seconds.';
        }
      };
      update(state);
      return { element, update };
    }

    successPanel(state) {
      const element = node('section', 'wizard-panel');
      const art = node('div', 'wizard-art');
      const mark = resultMark('success');
      art.append(mark);
      const name = state.controller?.name || state.device?.name || 'Your controller';
      const title = node('h2', '', 'Controller connected');
      const body = node('p', '', `${name} is ready to play.`);
      const done = this.button('Done', 'done', { primary: true });
      done.addEventListener('click', () => this.flow.cancel());
      element.append(art, title, body, this.actions(done));
      const enter = () => {
        // Pop with overshoot, then draw the check on the next frame.
        const pop = this.scheduler.create({ s: 0.3 }, (v) => { art.style.transform = `scale(${v.s.toFixed(4)})`; }, { stiffness: 260, damping: 12 });
        pop.to({ s: 1 });
        requestAnimationFrame(() => mark.classList.add('drawn'));
      };
      return { element, update() {}, enter };
    }

    errorPanel(state) {
      const element = node('section', 'wizard-panel');
      const art = node('div', 'wizard-art');
      const mark = resultMark('error');
      art.append(mark);
      const title = node('h2', '', 'Couldn’t connect');
      const body = node('p', '', state.message);
      const retry = this.button('Try Again', 'retry', { primary: true });
      retry.addEventListener('click', () => this.flow.retry());
      const close = this.button('Close', 'cancel');
      close.addEventListener('click', () => this.flow.cancel());
      element.append(art, title, body, this.actions(retry, close));
      const enter = () => {
        // Physical shake: an impulse on a stiff spring, so it rattles and settles on its own.
        const shake = this.scheduler.create({ x: 0 }, (v) => { art.style.transform = `translate3d(${v.x.toFixed(2)}px, 0, 0)`; }, { stiffness: 420, damping: 14 });
        shake.to({ x: 0 }, { x: 900 });
        requestAnimationFrame(() => mark.classList.add('drawn'));
      };
      return { element, update() {}, enter };
    }

    /**
     * Unified input entry point (keyboard + gamepad).
     * @param {'up'|'down'|'left'|'right'|'confirm'|'back'|'menu'} action
     */
    handleAction(action) {
      if (!this.dialog.open) return;
      if (action === 'back') { this.flow.cancel(); return; }
      if (action === 'confirm') { document.activeElement?.click?.(); return; }
      if (!['up', 'down', 'left', 'right'].includes(action)) return;
      const controls = [...this.current.element.querySelectorAll('button')].filter((button) => !button.disabled && button.getClientRects().length);
      const rects = controls.map((control, index) => toRect(index, control));
      const from = controls.indexOf(document.activeElement);
      if (from === -1) { controls[0]?.focus(); return; }
      const next = findNext(rects[from], rects, action);
      if (next !== null) controls[next].focus();
    }
  }

  return PairingWizardUI;
})();
