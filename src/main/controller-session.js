'use strict';

const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFile } = require('node:fs/promises');
const { LinuxControllerHardware, cleanText, batteryPercent, within } = require('./controller-hardware');
const { WINDOWS_RADIO_SCRIPT, WINDOWS_DONGLE_SCRIPT } = require('./controller-windows');

const execAsync = promisify(execFile);
const MAC = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const MESSAGES = {
  BLUETOOTH_UNAVAILABLE: 'Bluetooth is unavailable. Install or enable the Bluetooth service in your system settings.',
  BLUETOOTH_SOFT_BLOCKED: 'Bluetooth is blocked. Choose Enable Bluetooth to try turning it on.',
  BLUETOOTH_HARD_BLOCKED: 'Bluetooth is blocked by hardware. Use the physical wireless switch or disable airplane mode.',
  ADAPTER_NOT_FOUND: 'No Bluetooth radio was found. Connect a Bluetooth adapter and try again.',
  ADAPTER_POWERED_OFF: 'The Bluetooth radio is off. Turn it on in system settings or choose Enable Bluetooth.',
  PERMISSION_DENIED: 'Your account cannot change this device. Allow access in system settings or ask an administrator.',
  DONGLE_NOT_FOUND: 'No Microsoft Xbox Wireless Adapter was found. Connect the adapter and try again.',
  DRIVER_MISSING: 'The Xbox Wireless Adapter needs xone. Installation instructions: https://github.com/dlundqvist/xone#installation . Drivers are never installed automatically.',
  DONGLE_PAIRING_UNSUPPORTED: 'This receiver does not expose supported pairing controls. Use its physical pairing button.',
  SCAN_TIMEOUT: 'No new controller connected before the search ended. Hold its Pair button and try again.',
  PAIR_FAILED: 'The controller could not be paired. Hold its Pair button and try again.',
  TRUST_FAILED: 'The controller could not be saved for automatic reconnection. Check Bluetooth permissions and retry.',
  CONNECT_FAILED: 'The controller was saved but could not connect. Turn it on and try again.',
  CANCELLED: 'Controller pairing was cancelled.',
  UNSUPPORTED_PLATFORM: 'Controller management is supported on Windows and Linux only.',
  UNKNOWN: 'Controller management failed. Check your system settings and try again.'
};
const failure = (code) => Object.assign(new Error(MESSAGES[code] || MESSAGES.UNKNOWN), { code });
const permission = (error) => ['EACCES', 'EPERM'].includes(error?.code) || /not authorized|not permitted|access.*denied|permission denied|authentication.*required/i.test(`${error?.stdout || ''} ${error?.stderr || ''} ${error?.message || ''}`);
const checkOutput = (result) => `${result?.stdout || ''}\n${result?.stderr || ''}\n${result?.message || ''}`;
const failedOutput = (result) => /failed|not available|not authorized|no default controller|org\.bluez\.error/i.test(checkOutput(result));


/** Owns one cancellable pairing operation, asynchronous commands and visibility-scoped battery sampling. */
class ControllerSession {
  constructor(options) {
    this.platform = options.platform || process.platform;
    this.parsers = options.parsers;
    this.spawn = options.spawn || spawn;
    this.run = options.run || ((command, args, settings) => execAsync(command, args, settings));
    this.readFile = options.readFile || readFile;
    this.hardware = options.hardware || new LinuxControllerHardware(options);
    this.openSettings = options.openSettings || (async () => { throw failure('BLUETOOTH_UNAVAILABLE'); });
    this.refocus = options.refocus || (() => {});
    this.emit = options.emit || (() => {});
    this.emitEvent = options.emitEvent || (() => {});
    this.scanTimeoutMs = options.scanTimeoutMs ?? 120000;
    this.pollIntervalMs = options.pollIntervalMs ?? 2500;
    this.batteryIntervalMs = options.batteryIntervalMs ?? 30000;
    this.scan = null; this.commands = new Set(); this.cleanup = Promise.resolve(); this.closed = false;
    this.controllers = []; this.visible = false; this.batteryTimer = null; this.statusPromise = null;
    this.inputPaths = new Map();
    this.pairRequest = null; this.disposing = false;
  }

  get supported() { return ['linux', 'win32'].includes(this.platform); }
  event(name, value) { if (!this.closed) this.emitEvent(name, structuredClone(value)); }
  update(value) { if (!this.closed) this.emit(value); return value; }
  error(code, transport = 'bluetooth') {
    if (!MESSAGES[code]) code = 'UNKNOWN';
    const message = MESSAGES[code]; this.event('pairing-error', { code, message });
    return this.update({ state: 'error', transport, devices: [], code, message });
  }

  async command(command, args, { timeout = 8000, session = null } = {}) {
    if (this.closed || session?.cancelled) throw failure('CANCELLED');
    const abort = new AbortController(); const entry = { abort, session }; this.commands.add(entry);
    try {
      return await this.run(command, args, { timeout, maxBuffer: 1024 * 1024, windowsHide: true,
        shell: false, killSignal: 'SIGKILL', signal: abort.signal, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
    } finally { this.commands.delete(entry); }
  }

  async checkBluetooth(session) {
    if (this.platform === 'win32') {
      let radios;
      try { const { stdout } = await this.command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_RADIO_SCRIPT], { session }); radios = JSON.parse(stdout || '[]'); }
      catch (error) { throw failure(permission(error) ? 'PERMISSION_DENIED' : 'BLUETOOTH_UNAVAILABLE'); }
      if (!Array.isArray(radios)) radios = [radios];
      if (!radios.length) throw failure('ADAPTER_NOT_FOUND');
      if (radios.every((radio) => radio.Disabled)) throw failure('ADAPTER_POWERED_OFF');
      return;
    }
    // Probe BlueZ before rfkill, then inspect radio presence and power in the specified order.
    let listed;
    try {
      listed = await this.command('bluetoothctl', ['list'], { session });
      if (permission(listed)) throw failure('PERMISSION_DENIED');
      if (/failed to connect|waiting to connect|not available/i.test(checkOutput(listed))) throw failure('BLUETOOTH_UNAVAILABLE');
    } catch (error) {
      if (MESSAGES[error.code]) throw error;
      throw failure(permission(error) ? 'PERMISSION_DENIED' : 'BLUETOOTH_UNAVAILABLE');
    }
    try {
      const blocked = await this.command('rfkill', ['list', 'bluetooth'], { session });
      if (/Hard blocked:\s*yes/i.test(blocked.stdout)) throw failure('BLUETOOTH_HARD_BLOCKED');
      if (/Soft blocked:\s*yes/i.test(blocked.stdout)) throw failure('BLUETOOTH_SOFT_BLOCKED');
    } catch (error) {
      if (MESSAGES[error.code]) throw error;
      // rfkill is optional on systems without a kernel rfkill interface.
      if (error.code !== 'ENOENT') throw failure(permission(error) ? 'PERMISSION_DENIED' : 'BLUETOOTH_UNAVAILABLE');
    }
    if (!/^\s*Controller\s+(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/im.test(listed.stdout || '')) throw failure('ADAPTER_NOT_FOUND');
    const shown = await this.command('bluetoothctl', ['show'], { session });
    if (!/^\s*Powered:\s*yes\s*$/im.test(shown.stdout || '')) throw failure('ADAPTER_POWERED_OFF');
  }

  async unblockBluetooth() {
    if (!this.supported) return { success: false, code: 'UNSUPPORTED_PLATFORM', message: MESSAGES.UNSUPPORTED_PLATFORM };
    try {
      if (this.platform === 'win32') { await this.openSettings('ms-settings:bluetooth'); return { success: true, message: 'Bluetooth settings are open. Enable your radio there.' }; }
      for (const [command, args] of [['rfkill', ['unblock', 'bluetooth']], ['bluetoothctl', ['power', 'on']]]) {
        const result = await this.command(command, args);
        if (failedOutput(result)) throw Object.assign(new Error(checkOutput(result)), { stdout: result.stdout });
      }
      await this.checkBluetooth();
      return { success: true, message: 'Bluetooth is enabled.' };
    } catch (error) {
      const code = MESSAGES[error.code] ? error.code : permission(error) ? 'PERMISSION_DENIED' : 'BLUETOOTH_UNAVAILABLE';
      return { success: false, code, message: MESSAGES[code] };
    }
  }

  getStatus(session = null) {
    if (session) return this.readStatus(session);
    if (!this.statusPromise) this.statusPromise = this.readStatus().finally(() => { this.statusPromise = null; });
    return this.statusPromise;
  }

  async readStatus(session = null) {
    const result = { platform: this.platform, supported: this.supported, message: '', controllers: [] };
    if (!this.supported) return { ...result, code: 'UNSUPPORTED_PLATFORM', message: MESSAGES.UNSUPPORTED_PLATFORM };
    try {
      if (this.platform === 'win32') {
        const { stdout } = await this.command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', this.parsers.WINDOWS_ENUM_SCRIPT], { session });
        result.controllers = this.parsers.parseWindowsDevices(stdout).filter((device) => device.connected);
      } else {
        const input = await this.readFile('/proc/bus/input/devices', 'utf8');
        if (session?.cancelled) throw failure('CANCELLED');
        result.controllers = this.parsers.parseInputDevices(input);
        const dongles = await this.hardware.dongles();
        if (session?.cancelled) throw failure('CANCELLED');
        this.inputPaths = await this.hardware.enrich(result.controllers, dongles);
        await Promise.all(result.controllers.filter((controller) => MAC.test(controller.id)).map(async (controller) => {
          try {
            const { stdout } = await this.command('bluetoothctl', ['info', controller.id], { session });
            const percentage = stdout.match(/Battery Percentage:\s*(?:0x[\da-f]+\s*\((\d+)\)|(\d+))/i);
            const battery = batteryPercent(percentage?.[1] ?? percentage?.[2]);
            if (battery !== null && controller.battery === null) controller.battery = battery;
          } catch { /* Wired/sysfs data remains usable when BlueZ is unavailable. */ }
        }));
        if (session?.cancelled) throw failure('CANCELLED');
      }
      this.acceptControllers(result.controllers);
    } catch (error) {
      result.code = error.code === 'CANCELLED' ? 'CANCELLED' : permission(error) ? 'PERMISSION_DENIED' : 'UNKNOWN';
      result.message = MESSAGES[result.code];
    }
    return result;
  }

  acceptControllers(controllers) {
    if (this.closed) return;
    const previous = new Map(this.controllers.map((controller) => [controller.id, controller]));
    for (const controller of controllers) {
      const old = previous.get(controller.id);
      if (old && (old.battery !== controller.battery || old.charging !== controller.charging)) this.event('battery-update', { id: controller.id, battery: controller.battery, charging: controller.charging });
    }
    if (JSON.stringify(this.controllers) !== JSON.stringify(controllers)) this.event('controllers-changed', controllers);
    this.controllers = structuredClone(controllers); this.scheduleBattery();
  }

  setVisible(visible) { this.visible = Boolean(visible); clearTimeout(this.batteryTimer); this.batteryTimer = null; if (this.visible && !this.closed) void this.getStatus(); }
  scheduleBattery() {
    clearTimeout(this.batteryTimer); this.batteryTimer = null;
    if (this.visible && this.controllers.length && !this.closed) {
      this.batteryTimer = setTimeout(() => { this.batteryTimer = null; void this.getStatus(); }, this.batteryIntervalMs);
      this.batteryTimer.unref?.();
    }
  }

  async getDongleStatus(session = null) {
    if (this.platform === 'win32') {
      try {
        const { stdout } = await this.command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_DONGLE_SCRIPT], { session });
        return { present: JSON.parse(stdout).Present === true, driver: null, pairingSupported: false };
      } catch (error) {
        if (session) throw failure(session.cancelled ? 'CANCELLED' : permission(error) ? 'PERMISSION_DENIED' : 'UNKNOWN');
        return { present: false, driver: null, pairingSupported: false };
      }
    }
    if (this.platform !== 'linux') return { present: false, driver: null, pairingSupported: false };
    const { present, driver, pairingSupported } = await this.hardware.dongles(); return { present, driver, pairingSupported };
  }
  startDonglePairing() { return this.start('dongle'); }

  async start(transport) {
    if (!['bluetooth', 'dongle', 'usb'].includes(transport)) return this.error('UNKNOWN');
    if (this.closed || this.disposing) return this.error('CANCELLED', transport);
    if (!this.supported) return this.error('UNSUPPORTED_PLATFORM', transport);
    if (this.scan || this.pairRequest) {
      const message = 'Controller pairing is already running. Cancel it before starting another search.';
      return { state: 'error', transport, devices: [], code: 'UNKNOWN', message };
    }
    const session = { transport, devices: new Map(), abort: false, timer: null, poll: null, cancelled: false, initialIds: new Set(), entries: [] };
    this.scan = session;
    try {
      await this.cleanup;
      if (transport === 'bluetooth') await this.checkBluetooth(session);
      if (session.cancelled) return this.cancelledResult(transport);
      if (transport === 'dongle' && this.platform === 'linux') {
        const dongles = await this.hardware.dongles();
        if (!dongles.present) throw failure('DONGLE_NOT_FOUND');
        if (dongles.driver !== 'xone') throw failure('DRIVER_MISSING');
        if (!dongles.pairingSupported) throw failure('DONGLE_PAIRING_UNSUPPORTED');
        session.entries = dongles.interfaces;
      } else if (transport === 'dongle' && this.platform === 'win32') {
        if (!(await this.getDongleStatus(session)).present) throw failure('DONGLE_NOT_FOUND');
      }
      if (transport !== 'bluetooth' || this.platform === 'win32') {
        const initial = await this.getStatus(session);
        if (initial.code) throw failure(initial.code);
        session.initialIds = new Set(initial.controllers.map((controller) => controller.id));
        if (session.cancelled) throw failure('CANCELLED');
        if (transport === 'dongle' && this.platform === 'linux') {
          for (const entry of session.entries) {
            if (session.cancelled) throw failure('CANCELLED');
            session.enableTask = this.hardware.setPairing(entry, true);
            await session.enableTask;
          }
        } else if (this.platform === 'win32' && transport === 'bluetooth') await this.openSettings('ms-settings:bluetooth');
        else if (this.platform === 'win32' && transport === 'dongle') await this.openSettings('ms-settings:connecteddevices');
        else if (transport === 'dongle') throw failure('DONGLE_PAIRING_UNSUPPORTED');
        if (session.cancelled) throw failure('CANCELLED');
        session.poll = setTimeout(() => void this.pollSession(session), this.pollIntervalMs);
      } else this.startScan(session);
      session.timer = setTimeout(() => void this.finish(session, 'SCAN_TIMEOUT'), this.scanTimeoutMs);
      return this.update({ state: 'scanning', transport, devices: [], message: transport === 'bluetooth' ? (this.platform === 'win32' ? 'Pair the controller in Windows Bluetooth settings. This window remains available.' : 'Searching for Xbox controllers. Hold the controller Pair button.') : 'Waiting for a new controller. Connect it or hold its Pair button.' });
    } catch (error) {
      const cancelled = session.cancelled;
      await this.stop(session);
      if (cancelled) return this.cancelledResult(transport);
      return this.error(cancelled ? 'CANCELLED' : permission(error) ? 'PERMISSION_DENIED' : error.code, transport);
    }
  }

  startScan(session) {
    const child = this.spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
    session.child = child; session.buffer = ''; session.bytes = 0;
    child.stdin?.on?.('error', (error) => {
      if (this.scan === session && !session.cancelled) void this.finish(session, permission(error) ? 'PERMISSION_DENIED' : 'BLUETOOTH_UNAVAILABLE');
    });
    child.stdout?.on('data', (chunk) => this.readScanOutput(session, chunk));
    child.stderr?.on('data', (chunk) => this.readScanOutput(session, chunk));
    child.on('error', (error) => { if (this.scan === session && !session.cancelled) void this.finish(session, permission(error) ? 'PERMISSION_DENIED' : 'BLUETOOTH_UNAVAILABLE'); });
    child.on('close', () => { session.exited = true; if (this.scan === session && !session.cancelled) void this.finish(session, 'BLUETOOTH_UNAVAILABLE'); });
    try { child.stdin?.write('scan on\n'); }
    catch (error) { void this.finish(session, permission(error) ? 'PERMISSION_DENIED' : 'BLUETOOTH_UNAVAILABLE'); }
  }

  readScanOutput(session, chunk) {
    if (this.scan !== session || session.cancelled) return;
    session.bytes += Buffer.byteLength(chunk);
    if (session.bytes > 1024 * 1024) { void this.finish(session, 'UNKNOWN'); return; }
    session.buffer += String(chunk).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    const lines = session.buffer.split(/\r?\n/); session.buffer = lines.pop() || '';
    for (const device of this.parsers.parseBluetoothDevices(lines.join('\n'))) {
      if (session.devices.has(device.id) || session.pending?.has(device.id)) continue;
      if ((session.pending?.size || 0) >= 8 || session.devices.size >= 64) continue;
      session.pending ||= new Set(); session.pending.add(device.id);
      // Discovery includes remembered devices. Verify that a candidate is not already paired.
      void this.command('bluetoothctl', ['info', device.id], { session }).then(({ stdout }) => {
        if (this.scan !== session || session.cancelled || /^\s*(?:Paired|Bonded):\s*yes/im.test(stdout || '')) return;
        session.devices.set(device.id, device); this.event('device-found', device);
        this.update({ state: 'scanning', transport: 'bluetooth', devices: [...session.devices.values()], message: 'Xbox controller found.' });
      }).catch((error) => {
        if (this.scan === session && !session.cancelled && permission(error)) void this.finish(session, 'PERMISSION_DENIED');
      }).finally(() => session.pending.delete(device.id));
    }
  }

  async pollSession(session) {
    if (this.scan !== session || session.cancelled) return;
    if (session.polling) return;
    session.polling = true;
    let status;
    try { status = await this.getStatus(session); }
    catch (error) {
      session.polling = false;
      if (this.scan === session && !session.cancelled) await this.finish(session, permission(error) ? 'PERMISSION_DENIED' : 'UNKNOWN');
      return;
    }
    session.polling = false;
    if (this.scan !== session || session.cancelled) return;
    if (status.code) {
      if (status.code !== 'CANCELLED') await this.finish(session, status.code);
      return;
    }
    const newlyConnected = status.controllers.filter((controller) => !session.initialIds.has(controller.id) && controller.transport === session.transport &&
      (!session.entries.length || session.entries.some((entry) => within(entry.directory, this.inputPaths.get(controller.id) || ''))));
    if (newlyConnected.length) {
      await this.stop(session);
      for (const controller of newlyConnected) this.event('pairing-success', controller);
      this.update({ state: 'complete', transport: session.transport, devices: newlyConnected, message: 'New controller connected.' });
      if (this.platform === 'win32') this.refocus();
    } else session.poll = setTimeout(() => void this.pollSession(session), this.pollIntervalMs);
  }

  // Kept for existing integrations and tests which manually advance the Windows monitor.
  pollWindowsScan(session) { clearTimeout(session.poll); return this.pollSession(session); }

  async pair(id) {
    if (this.closed || this.disposing) return this.pairFailure('CANCELLED');
    if (!this.supported) return this.pairFailure('UNSUPPORTED_PLATFORM');
    if (this.platform === 'win32') {
      if (typeof id !== 'string' || !/^win:[a-f0-9]{64}$/.test(id)) return this.pairFailure('UNKNOWN');
      const { controllers } = await this.getStatus();
      const controller = controllers.find((item) => item.id === id);
      if (controller) return { success: true, controller, message: 'Windows confirms the controller is connected.' };
      return this.pairFailure('PAIR_FAILED');
    }
    if (typeof id !== 'string' || !MAC.test(id)) return this.pairFailure('UNKNOWN');
    if (this.scan?.pairing || this.pairRequest) return this.pairFailure('PAIR_FAILED');
    const request = { cancelled: false }; this.pairRequest = request;
    if (this.scan) await this.stop(this.scan); else await this.cleanup;
    if (request.cancelled || this.closed) { this.pairRequest = null; return this.pairFailure('CANCELLED'); }
    const session = { transport: 'bluetooth', devices: new Map(), entries: [], cancelled: false, pairing: true };
    this.scan = session;
    this.pairRequest = null;
    id = id.toUpperCase();
    let stage = 'PAIR_FAILED';
    try {
      for (const [verb, timeout, code, confirmation] of [
        ['pair', 60000, 'PAIR_FAILED', /Pairing successful|AlreadyExists/i],
        ['trust', 15000, 'TRUST_FAILED', /trust succeeded|Trusted:\s*yes/i],
        ['connect', 30000, 'CONNECT_FAILED', /Connection successful|Connected:\s*yes|AlreadyConnected/i]
      ]) {
        stage = code;
        let result;
        try { result = await this.command('bluetoothctl', [verb, id], { timeout, session }); }
        catch (error) { if (verb === 'pair' && /AlreadyExists/i.test(checkOutput(error))) result = error; else throw error; }
        if (session.cancelled) throw failure('CANCELLED');
        if (!confirmation.test(checkOutput(result))) throw failure(code);
      }
      const { stdout = '' } = await this.command('bluetoothctl', ['info', id], { session });
      if (!/^\s*Paired:\s*yes\s*$/im.test(stdout)) throw failure('PAIR_FAILED');
      if (!/^\s*Trusted:\s*yes\s*$/im.test(stdout)) throw failure('TRUST_FAILED');
      if (!/^\s*Connected:\s*yes\s*$/im.test(stdout)) throw failure('CONNECT_FAILED');
      const battery = stdout.match(/Battery Percentage:\s*(?:0x[\da-f]+\s*\((\d+)\)|(\d+))/i);
      const controller = { id, name: cleanText(stdout.match(/^\s*Name:\s*(.+)$/im)?.[1]) || 'Xbox Wireless Controller', transport: 'bluetooth', battery: batteryPercent(battery?.[1] ?? battery?.[2]), charging: false, connected: true };
      if (session.cancelled) throw failure('CANCELLED');
      await this.stop(session); this.event('pairing-success', controller);
      this.acceptControllers([...this.controllers.filter((item) => item.id !== id), controller]);
      this.update({ state: 'complete', transport: 'bluetooth', devices: [controller], message: 'Controller paired, saved and connected.' });
      return { success: true, message: 'Controller paired, saved and connected.', controller };
    } catch (error) {
      const cancelled = session.cancelled;
      await this.stop(session);
      if (cancelled) return { success: false, code: 'CANCELLED', message: MESSAGES.CANCELLED };
      return this.pairFailure(permission(error) ? 'PERMISSION_DENIED' : MESSAGES[error.code] ? error.code : stage);
    }
  }

  pairFailure(code) { const result = this.error(code); return { success: false, code: result.code, message: result.message }; }

  async finish(session, code) { if (this.scan !== session || session.cancelled) return; await this.stop(session); this.error(code, session.transport); }

  cancelledResult(transport) {
    return { state: 'cancelled', transport, devices: [], code: 'CANCELLED', message: MESSAGES.CANCELLED };
  }

  stop(session) {
    if (session.stopping) return session.stopping;
    session.cancelled = true; clearTimeout(session.timer); clearTimeout(session.poll);
    for (const entry of this.commands) if (entry.session === session) entry.abort.abort();
    session.stopping = (async () => {
      if (session.child) {
        try { session.child.stdin?.write('scan off\nquit\n'); } catch { /* The child may already have exited. */ }
        session.child.kill();
        // Escalate if bluetoothctl ignores termination. Timer is bounded and does not keep Node alive.
        const force = setTimeout(() => { if (!session.exited) session.child.kill('SIGKILL'); }, 200);
        force.unref?.();
        try { await this.command('bluetoothctl', ['scan', 'off'], { timeout: 2000 }); } catch { /* The Bluetooth service may already be gone. */ }
      }
      try { await session.enableTask; } catch { /* Failed writes are reported by start(). */ }
      for (const entry of session.entries || []) {
        try { await this.hardware.setPairing(entry, false); }
        catch (error) { if (error.code !== 'ENOENT') this.error(permission(error) ? 'PERMISSION_DENIED' : 'UNKNOWN', 'dongle'); }
      }
      if (this.scan === session) this.scan = null;
    })();
    this.cleanup = session.stopping; return session.stopping;
  }

  async cancel(emit = true) {
    const pending = this.pairRequest;
    if (pending) pending.cancelled = true;
    const session = this.scan;
    if (!session) { await this.cleanup; return { cancelled: Boolean(pending) }; }
    await this.stop(session);
    if (emit) {
      this.event('pairing-error', { code: 'CANCELLED', message: MESSAGES.CANCELLED });
      this.update({ state: 'cancelled', transport: session.transport, devices: [], code: 'CANCELLED', message: MESSAGES.CANCELLED });
    }
    return { cancelled: true };
  }

  async dispose() {
    this.disposing = true;
    this.visible = false; clearTimeout(this.batteryTimer); this.batteryTimer = null;
    await this.cancel(false);
    this.closed = true;
    for (const entry of this.commands) entry.abort.abort();
  }
}

module.exports = { ControllerSession, WINDOWS_RADIO_SCRIPT, WINDOWS_DONGLE_SCRIPT, MESSAGES };
