'use strict';

/**
 * Settings -> Controllers. Wires the service, the device list and the pairing wizard together.
 * The only things it needs from the app shell are a way to switch the input-routing view and to show toasts.
 */
window.ControllersPage = (function () {
  const POLL_INTERVAL_MS = 8000;
  const $ = (selector) => document.querySelector(selector);

  let service;
  let flow;
  let list;
  let wizard;
  let scheduler;
  let context;
  let active = false;
  let pollTimer = null;
  let refreshToken = 0;

  async function refresh({ quiet = false } = {}) {
    const token = ++refreshToken;
    const button = $('#refresh-controllers');
    if (!quiet) { button.disabled = true; list.showLoading(); }
    try {
      const status = await service.getStatus();
      if (token !== refreshToken) return;
      const platform = status.platform ? status.platform.charAt(0).toUpperCase() + status.platform.slice(1) : '';
      $('#controller-platform').textContent = service.isMock ? 'Preview data' : platform;
      $('#controller-platform').hidden = !service.isMock && !platform;
      list.render(status.controllers);
      $('#controller-hint').textContent = status.supported ? status.message : (status.message || 'Controller management is not available on this system.');
      $('#pair-new-controller').disabled = !status.supported;
    } catch (error) {
      if (token === refreshToken) list.showError(`Unable to check controllers: ${error.message}`);
    } finally {
      if (token === refreshToken) button.disabled = false;
    }
  }

  /** Polls only while the Controllers page is visible, so battery levels stay fresh without background work. */
  function setActive(next) {
    if (next === active) return;
    active = next;
    clearInterval(pollTimer);
    pollTimer = null;
    if (!active) return;
    refresh();
    pollTimer = setInterval(() => { if (!wizard.isOpen) refresh({ quiet: true }); }, POLL_INTERVAL_MS);
  }

  function init(options) {
    context = options;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    scheduler = new window.MenuMotion.MotionScheduler({ reducedMotion: query.matches });
    query.addEventListener('change', (event) => scheduler.setReducedMotion(event.matches));

    const { bridge, source } = window.ControllerService.resolveBridge(window, location.search);
    service = window.ControllerService.createControllerService({ bridge, source });
    flow = new window.PairingFlow.PairingFlow(service);
    list = new window.ControllerList({ container: $('#controller-list'), scheduler });
    wizard = new window.PairingWizardUI({
      dialog: $('#pairing-dialog'),
      flow,
      scheduler,
      onClosed: () => {
        context.setView('settings');
        refresh({ quiet: true });
        $('#pair-new-controller').focus();
      }
    });

    $('#pair-new-controller').addEventListener('click', () => {
      context.setView('pairing');
      wizard.open();
    });
    $('#refresh-controllers').addEventListener('click', () => refresh());
    service.on('controllersChanged', () => { if (active) refresh({ quiet: true }); });
    list.showLoading();
  }

  return {
    init,
    setActive,
    refresh,
    get isWizardOpen() { return Boolean(wizard?.isOpen); },
    /** Routes input while the wizard is open. */
    handleAction: (action) => wizard?.handleAction(action)
  };
})();
