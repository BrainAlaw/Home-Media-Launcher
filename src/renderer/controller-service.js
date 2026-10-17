(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ControllerService = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Frontend service layer for controller management. The UI never talks to the IPC bridge directly:
   * it talks to this service, which adapts whatever the backend exposes and falls back to a mock.
   *
   * Backend contract (any of `window.launcher` / `window.api` that implements it is picked up):
   *
   *   getConnectedGamepads() | getControllerStatus()
   *       -> Promise<RawController[] | { platform?, supported?, message?, controllers: RawController[] }>
   *   startControllerPairing(transport)  -> Promise<void | { state, devices?, message? }>
   *   cancelControllerPairing()          -> Promise<unknown>
   *   pairController(deviceId)           -> Promise<{ success: boolean, message?, controller? }>
   *   onDeviceFound(cb) / onPairingSuccess(cb) / onPairingError(cb) / onControllersChanged(cb)   (optional)
   *       each returns an unsubscribe function.
   *   onControllerPairingUpdate(cb)  (optional) pushes { state: 'scanning' | 'complete' | 'error' | 'cancelled',
   *       devices?, message? } updates; the service turns them into the events above.
   *
   * Without the optional events the service derives them from the promise results, so a request/response-only
   * backend works too.
   *
   * @typedef {'bluetooth' | 'dongle' | 'usb'} Transport
   * @typedef {{ id: string, name: string, transport: Transport | 'unknown', battery: number | null, charging: boolean }} Controller
   * @typedef {{ id: string, name: string, transport: Transport | 'unknown' }} FoundDevice
   * @typedef {{ platform: string, supported: boolean, message: string, controllers: Controller[] }} ControllerStatus
   * @typedef {'deviceFound' | 'pairingSuccess' | 'pairingError' | 'controllersChanged'} ServiceEvent
   */

  const TRANSPORTS = Object.freeze(['bluetooth', 'dongle', 'usb']);
  const CONNECTED_METHODS = ['getConnectedGamepads', 'getControllerStatus'];
  const REQUIRED_METHODS = ['startControllerPairing', 'pairController'];
  const DEFAULT_NAME = 'Xbox Wireless Controller';

  /** @param {unknown} value @returns {Transport | 'unknown'} */
  function normalizeTransport(value) {
    const text = String(value ?? '').toLowerCase();
    if (/dongle|adapter|2\.4|xinput-wireless/.test(text)) return 'dongle';
    if (/usb|wired|cable/.test(text)) return 'usb';
    if (/blue|\bbt\b|\bble\b/.test(text)) return 'bluetooth';
    return 'unknown';
  }

  /** @param {any} raw @param {number} [index] @returns {Controller} */
  function normalizeController(raw, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const batteryValue = source.battery && typeof source.battery === 'object'
      ? (source.battery.percent ?? source.battery.level)
      : (source.battery ?? source.batteryPercent);
    return {
      id: String(source.id ?? source.path ?? `controller-${index}`),
      name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : DEFAULT_NAME,
      transport: normalizeTransport(source.transport ?? source.connection ?? source.type),
      battery: Number.isFinite(batteryValue) ? Math.max(0, Math.min(100, Math.round(batteryValue))) : null,
      charging: source.charging === true || source.battery?.charging === true
    };
  }

  /** @param {any} raw @returns {FoundDevice} */
  function normalizeDevice(raw) {
    const { id, name, transport } = normalizeController(raw);
    return { id, name, transport };
  }

  /** @param {any} result @returns {ControllerStatus} */
  function normalizeStatus(result) {
    const list = Array.isArray(result) ? result : Array.isArray(result?.controllers) ? result.controllers : [];
    return {
      platform: typeof result?.platform === 'string' ? result.platform : '',
      supported: result?.supported !== false,
      message: typeof result?.message === 'string' ? result.message : '',
      controllers: list.map(normalizeController)
    };
  }

  const errorMessage = (error, fallback) => (typeof error === 'string' ? error : error?.message || fallback);

  function createEmitter() {
    /** @type {Map<string, Set<Function>>} */
    const listeners = new Map();
    return {
      on(event, callback) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(callback);
        return () => listeners.get(event)?.delete(callback);
      },
      emit(event, payload) {
        for (const callback of [...(listeners.get(event) || [])]) callback(payload);
      }
    };
  }

  /**
   * Development backend that behaves like the real one: two connected controllers, a scan that finds a
   * device after a short delay, and pairing that succeeds, fails or is flaky depending on `scenario`.
   *
   * @param {{ scenario?: 'success' | 'error' | 'flaky' | 'empty', platform?: string, findDelay?: number, pairDelay?: number,
   *           timers?: { setTimeout: Function, clearTimeout: Function } }} [options]
   */
  function createMockBackend(options = {}) {
    const {
      scenario = 'success', platform = 'linux', findDelay = 3200, pairDelay = 1800,
      timers = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args) }
    } = options;
    const events = createEmitter();
    let connected = [
      { id: 'mock-bt-1', name: DEFAULT_NAME, transport: 'bluetooth', battery: 78, charging: false },
      { id: 'mock-dongle-1', name: 'Xbox Elite Series 2', transport: 'dongle', battery: 22, charging: true }
    ];
    let scanTimer = null;
    let transport = 'bluetooth';
    let pairAttempts = 0;
    const subscribe = (event) => (callback) => events.on(event, callback);

    return {
      isMock: true,
      getConnectedGamepads: async () => ({ platform, supported: true, controllers: connected.map((controller) => ({ ...controller })) }),
      startControllerPairing: async (requested) => {
        transport = requested;
        timers.clearTimeout(scanTimer);
        scanTimer = timers.setTimeout(() => {
          if (scenario === 'empty') events.emit('pairingError', { message: 'No controller was found. Make sure it is in pairing mode and try again.' });
          else events.emit('deviceFound', { id: `mock-new-${pairAttempts + 1}`, name: DEFAULT_NAME, transport });
        }, findDelay);
        return { state: 'scanning' };
      },
      cancelControllerPairing: async () => {
        timers.clearTimeout(scanTimer);
        return { cancelled: true };
      },
      pairController: (id) => new Promise((resolve) => {
        timers.setTimeout(() => {
          pairAttempts += 1;
          const fail = scenario === 'error' || (scenario === 'flaky' && pairAttempts === 1);
          if (fail) {
            const message = 'The controller refused the connection. Hold its Pair button again and retry.';
            events.emit('pairingError', { message });
            resolve({ success: false, message });
            return;
          }
          const controller = { id, name: DEFAULT_NAME, transport, battery: 100, charging: false };
          connected = [...connected, controller];
          events.emit('pairingSuccess', controller);
          events.emit('controllersChanged', connected);
          resolve({ success: true, controller });
        }, pairDelay);
      }),
      onDeviceFound: subscribe('deviceFound'),
      onPairingSuccess: subscribe('pairingSuccess'),
      onPairingError: subscribe('pairingError'),
      onControllersChanged: subscribe('controllersChanged')
    };
  }

  /**
   * Picks the real bridge when present, otherwise the mock. `?controllerMock=success|error|flaky|empty`
   * forces the mock for design and QA work.
   * @param {any} globalObject @param {string} [search]
   * @returns {{ bridge: any, source: string }}
   */
  function resolveBridge(globalObject, search = '') {
    const forced = new URLSearchParams(search).get('controllerMock');
    if (forced) return { bridge: createMockBackend({ scenario: forced }), source: 'mock' };
    for (const name of ['launcher', 'api']) {
      const candidate = globalObject?.[name];
      if (candidate
        && CONNECTED_METHODS.some((method) => typeof candidate[method] === 'function')
        && REQUIRED_METHODS.every((method) => typeof candidate[method] === 'function')) return { bridge: candidate, source: name };
    }
    return { bridge: createMockBackend(), source: 'mock' };
  }

  /**
   * Normalising facade over a bridge.
   * @param {{ bridge: any, source?: string }} options
   */
  function createControllerService({ bridge, source = 'bridge' }) {
    const emitter = createEmitter();
    const connectedMethod = CONNECTED_METHODS.find((method) => typeof bridge[method] === 'function');
    const hasEvents = typeof bridge.onDeviceFound === 'function';
    const forwarded = [];
    const seenDevices = new Set();
    let activeTransport = 'bluetooth';

    /** Turns a `{ state, devices, message }` update into service events (each device is announced once per scan). */
    function translateUpdate(update) {
      const transport = update?.transport || activeTransport;
      for (const raw of transport === 'bluetooth' ? update?.devices || [] : []) {
        const device = normalizeDevice(raw);
        if (seenDevices.has(device.id)) continue;
        seenDevices.add(device.id);
        emitter.emit('deviceFound', device);
      }
      if (update?.state === 'error' || (transport === 'bluetooth' && update?.state === 'complete' && !update?.devices?.length)) {
        emitter.emit('pairingError', { message: update.message || 'No controllers were found. Check pairing mode and try again.' });
      }
    }

    if (!hasEvents && typeof bridge.onControllerPairingUpdate === 'function') {
      forwarded.push(bridge.onControllerPairingUpdate(translateUpdate));
    }
    if (hasEvents) {
      forwarded.push(
        bridge.onDeviceFound((device) => emitter.emit('deviceFound', normalizeDevice(device))),
        bridge.onPairingSuccess?.((controller) => emitter.emit('pairingSuccess', normalizeController(controller))),
        bridge.onPairingError?.((error) => emitter.emit('pairingError', { message: errorMessage(error, '') })),
        bridge.onControllersChanged?.(() => emitter.emit('controllersChanged'))
      );
    }

    return {
      source,
      isMock: source === 'mock',
      on: emitter.on,

      /** @returns {Promise<ControllerStatus>} */
      async getStatus() {
        if (!connectedMethod) return normalizeStatus([]);
        return normalizeStatus(await bridge[connectedMethod]());
      },

      /** @param {Transport} transport */
      async startPairing(transport) {
        activeTransport = transport;
        seenDevices.clear();
        const update = await bridge.startControllerPairing(transport);
        // Request/response backends: the returned update is translated the same way as pushed ones.
        if (!hasEvents) translateUpdate(update);
        return update;
      },

      async stopPairing() {
        try { await bridge.cancelControllerPairing?.(); } catch { /* best effort: the UI closes regardless */ }
      },

      /** @param {string} id @returns {Promise<{ success: boolean, message: string, controller: Controller | null }>} */
      async pairDevice(id) {
        const result = await bridge.pairController(id);
        return {
          success: result?.success !== false,
          message: typeof result?.message === 'string' ? result.message : '',
          controller: result?.controller ? normalizeController(result.controller) : null
        };
      },

      dispose() { forwarded.forEach((unsubscribe) => unsubscribe?.()); }
    };
  }

  return {
    TRANSPORTS, normalizeTransport, normalizeController, normalizeDevice, normalizeStatus,
    createMockBackend, resolveBridge, createControllerService
  };
});
