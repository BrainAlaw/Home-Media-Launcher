(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PairingFlow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * UI-less pairing state machine. The wizard view only renders `state`; every transition lives here so it can
   * be tested without a DOM.
   *
   * @typedef {'closed' | 'instructions' | 'scanning' | 'success' | 'error'} Step
   * @typedef {{ step: Step, phase: 'idle' | 'searching' | 'connecting', transport: string,
   *             device: { id: string, name: string } | null, controller: any, message: string }} PairingState
   */

  const TRANSPORTS = ['bluetooth', 'dongle', 'usb'];
  const SEARCH_TIMEOUT_MS = 45000;
  const CONNECT_TIMEOUT_MS = 20000;
  const FALLBACK_ERROR = 'The controller could not be paired. Please try again.';

  /** @type {PairingState} */
  const INITIAL = Object.freeze({ step: 'closed', phase: 'idle', transport: 'bluetooth', device: null, controller: null, message: '' });

  /**
   * Pure reducer. Events that do not apply to the current step are ignored, which makes the flow idempotent
   * when a backend reports the same outcome through both a promise and an event.
   * @param {PairingState} state @param {{ type: string, [key: string]: any }} event
   * @returns {PairingState}
   */
  function reduce(state, event) {
    switch (event.type) {
      case 'open':
        return { ...INITIAL, step: 'instructions', transport: TRANSPORTS.includes(event.transport) ? event.transport : state.transport };
      case 'transport':
        return state.step === 'instructions' && TRANSPORTS.includes(event.transport) ? { ...state, transport: event.transport } : state;
      case 'begin':
        return state.step === 'instructions' ? { ...state, step: 'scanning', phase: 'searching', device: null, message: '' } : state;
      case 'deviceFound':
        return state.step === 'scanning' && state.phase === 'searching' ? { ...state, phase: 'connecting', device: event.device } : state;
      case 'success':
        return state.step === 'scanning' ? { ...state, step: 'success', phase: 'idle', controller: event.controller || null, message: '' } : state;
      case 'failure':
        return state.step === 'scanning' ? { ...state, step: 'error', phase: 'idle', message: event.message || FALLBACK_ERROR } : state;
      case 'retry':
        return state.step === 'error' ? { ...state, step: 'instructions', device: null, message: '' } : state;
      case 'close':
        return state.step === 'closed' ? state : { ...INITIAL, transport: state.transport };
      default:
        return state;
    }
  }

  const defaultTimers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args) };

  class PairingFlow {
    /**
     * @param {ReturnType<import('./controller-service').createControllerService>} service
     * @param {{ timers?: typeof defaultTimers, searchTimeoutMs?: number, connectTimeoutMs?: number }} [options]
     */
    constructor(service, options = {}) {
      this.service = service;
      this.timers = options.timers || defaultTimers;
      this.searchTimeoutMs = options.searchTimeoutMs ?? SEARCH_TIMEOUT_MS;
      this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
      /** @type {PairingState} */
      this.state = INITIAL;
      this.attempt = 0;
      this.listeners = new Set();
      this.unsubscribes = [];
      this.timeout = null;
    }

    /** @param {(state: PairingState, previous: PairingState) => void} listener @returns {() => void} */
    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    dispatch(event) {
      const previous = this.state;
      this.state = reduce(previous, event);
      if (this.state !== previous) for (const listener of [...this.listeners]) listener(this.state, previous);
    }

    open(transport) { this.dispatch({ type: 'open', transport }); }
    setTransport(transport) { this.dispatch({ type: 'transport', transport }); }
    retry() { this.dispatch({ type: 'retry' }); }

    /** Instructions -> scanning. Starts discovery and listens for backend events. */
    begin() {
      if (this.state.step !== 'instructions') return;
      this.dispatch({ type: 'begin' });
      const attempt = ++this.attempt;
      this.unsubscribes = [
        this.service.on('deviceFound', (device) => this.handleDevice(attempt, device)),
        this.service.on('pairingSuccess', (controller) => this.succeed(attempt, controller)),
        this.service.on('pairingError', (error) => this.fail(attempt, error?.message))
      ];
      this.arm(attempt, this.searchTimeoutMs, 'No controller was found. Make sure it is in pairing mode and try again.');
      Promise.resolve()
        .then(async () => {
          const transport = this.state.transport;
          const result = await this.service.startPairing(transport);
          if (transport === 'bluetooth' || attempt !== this.attempt || this.state.step !== 'scanning') return;
          const status = await this.service.getStatus();
          const controller = status.controllers.find((device) => device.transport === transport);
          if (controller) this.succeed(attempt, controller);
          else this.fail(attempt, result?.message || status.message || 'No controller was detected. Check its connection and try again.');
        })
        .catch((error) => this.fail(attempt, error?.message || 'Unable to start searching for controllers.'));
    }

    /** Back/cancel from any step: stops discovery if needed and closes the wizard. */
    cancel() {
      const scanning = this.state.step === 'scanning';
      this.attempt += 1;
      this.cleanup();
      if (scanning) this.service.stopPairing();
      this.dispatch({ type: 'close' });
    }

    handleDevice(attempt, device) {
      if (attempt !== this.attempt || this.state.step !== 'scanning' || this.state.phase !== 'searching') return;
      this.dispatch({ type: 'deviceFound', device });
      this.arm(attempt, this.connectTimeoutMs, 'The controller did not finish connecting. Please try again.');
      Promise.resolve()
        .then(() => this.service.pairDevice(device.id))
        .then((result) => (result.success ? this.succeed(attempt, result.controller || device) : this.fail(attempt, result.message)))
        .catch((error) => this.fail(attempt, error?.message));
    }

    succeed(attempt, controller) {
      if (attempt !== this.attempt) return;
      this.cleanup();
      this.dispatch({ type: 'success', controller });
    }

    fail(attempt, message) {
      if (attempt !== this.attempt) return;
      this.cleanup();
      this.dispatch({ type: 'failure', message });
    }

    arm(attempt, delay, message) {
      this.timers.clearTimeout(this.timeout);
      this.timeout = this.timers.setTimeout(() => {
        this.service.stopPairing();
        this.fail(attempt, message);
      }, delay);
    }

    cleanup() {
      this.timers.clearTimeout(this.timeout);
      this.timeout = null;
      this.unsubscribes.forEach((unsubscribe) => unsubscribe());
      this.unsubscribes = [];
    }
  }

  return { PairingFlow, reduce, INITIAL, TRANSPORTS, SEARCH_TIMEOUT_MS, CONNECT_TIMEOUT_MS };
});
