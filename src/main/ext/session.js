'use strict';

const { createSessionMachine } = require('../session-machine');
const { GuideWatcher } = require('../guide-watcher');
const { ExitOverlay, chooseOverlayMode } = require('../exit-overlay');

/**
 * ns `session` (agent E): owns the launching/running/closing/idle lifecycle of the external application,
 * the launcher-to-app hand-off timing and the controller-only exit gesture for native applications.
 * Events: `phase` (SessionPhase), `notice` ({ message }). Methods: `closeActive()`, `getStatus()`.
 * index.js drives it through `controller` (attach / begin / handoff / closing / finish / fail).
 */

/** The launcher keeps covering the screen at least this long, so the renderer's fade to black has finished first. */
const MIN_COVER_MS = 520;
/** Upper bound for waiting until a native application has taken the focus from the launcher. */
const HANDOFF_MAX_MS = 2200;
/** Grace period between a web window becoming visible and the launcher window being hidden underneath it. */
const WEB_SETTLE_MS = 200;
/** After Moonlight's own quit chord, wait this long for the stream process to exit before terminating it. */
const COMBO_WATCHDOG_MS = 2500;
/** Delay before the "closed directly" notice, so the toast is not played over the black return transition. */
const NOTICE_DELAY_MS = 700;

const defaultDelay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function createController({ now = Date.now, delay = defaultDelay, createWatcher = () => new GuideWatcher() } = {}) {
  let emit = () => {};
  /** @type {null | { getLauncherWindow(): any, processManager: any, closeWebWindow(): void, showLauncher(): void, onPhase?(phase: object): void, electron?: { BrowserWindow: any, screen: any }, ozonePlatform?: string, env?: object, platform?: string }} */
  let hooks = null;
  let beganAt = 0;
  let kind = 'native';
  let isStream = false;
  let watcher = null;
  let overlay = null;
  let overlayShown = false;
  let comboTimer = null;
  let pendingNotice = '';
  let guideStatus = { available: false, reason: 'idle' };

  const machine = createSessionMachine({
    onChange: (snapshot) => {
      emit('phase', snapshot);
      try { hooks?.onPhase?.(snapshot); } catch (error) { console.warn('Session phase hook failed:', error.message); }
      // Web windows detect the Guide button themselves (Gamepad API button 16), except on Windows where Chromium never reports it.
      if (snapshot.phase === 'running' && (kind === 'native' || (hooks?.platform ?? process.platform) === 'win32')) startWatching();
      if (snapshot.phase === 'idle') {
        stopWatching();
        if (pendingNotice) {
          const message = pendingNotice;
          pendingNotice = '';
          void delay(NOTICE_DELAY_MS).then(() => emit('notice', { message }));
        }
      }
    }
  });

  function ensureOverlay() {
    if (overlay || !hooks?.electron) return overlay;
    overlay = new ExitOverlay({
      ...hooks.electron,
      mode: chooseOverlayMode({ platform: hooks.platform, env: hooks.env, ozonePlatform: hooks.ozonePlatform })
    });
    return overlay;
  }

  function startWatching() {
    if (watcher) return;
    watcher = createWatcher();
    guideStatus = { available: true, reason: '' };
    watcher.on('progress', (progress) => {
      const target = ensureOverlay();
      if (!target?.usable) return;
      if (!overlayShown) { overlayShown = true; void target.show(machine.snapshot().name).then((visible) => { if (!visible) overlayShown = false; }); }
      target.update(progress);
    });
    watcher.on('cancel', () => { overlayShown = false; overlay?.hide(); });
    watcher.on('complete', () => {
      const visible = overlay?.visible === true;
      overlayShown = false;
      overlay?.hide();
      // Without a visible overlay (Wayland, no always-on-top) the application is closed directly and the user is told afterwards.
      if (!visible && machine.phase === 'running') pendingNotice = `Closed ${machine.snapshot().name} (hold gesture)`;
      void controller.closeActive();
    });
    watcher.on('combo', () => {
      if (!isStream || comboTimer) return;
      // Moonlight quits itself on Start+Select+L1+R1; make sure a hung stream process still ends in the same finished path.
      comboTimer = setTimeout(() => { comboTimer = null; if (machine.phase === 'running') void controller.closeActive(); }, COMBO_WATCHDOG_MS);
      comboTimer.unref?.();
    });
    watcher.on('unavailable', (reason) => {
      guideStatus = { available: false, reason };
      console.warn('Guide button detection unavailable:', reason);
    });
    watcher.start();
  }

  function stopWatching() {
    clearTimeout(comboTimer);
    comboTimer = null;
    overlayShown = false;
    if (watcher) { watcher.stop(); watcher.removeAllListeners(); watcher = null; }
    if (overlay) { overlay.destroy(); overlay = null; }
    guideStatus = { available: false, reason: 'idle' };
  }

  const controller = {
    machine,
    setEmitter(callback) { emit = callback; },
    /** @param {NonNullable<typeof hooks>} nextHooks */
    attach(nextHooks) { hooks = nextHooks; },
    get phase() { return machine.phase; },
    snapshot: () => machine.snapshot(),

    /** @returns {boolean} false when another session is in flight */
    begin(tile) {
      const started = machine.beginLaunch(tile.id, tile.name || tile.title || tile.id);
      if (started) {
        beganAt = now();
        kind = tile.type === 'website' ? 'web' : 'native';
        isStream = tile.type === 'moonlight' || tile.provider === 'remote';
      }
      return started;
    },

    /** Launch failed before an application window existed: back to idle so the renderer animates home. */
    fail() { return machine.finish(); },

    /**
     * Keeps the launcher covering the screen until the minimum cover time passed and (native) the application took the focus,
     * then marks the session running and lets the caller hide the launcher. Resolves false if the session ended meanwhile.
     */
    async handoff({ hide, window = null, waitForBlur = false }) {
      const remaining = MIN_COVER_MS - (now() - beganAt);
      if (remaining > 0) await delay(remaining);
      if (waitForBlur && window && !window.isDestroyed?.() && window.isFocused?.()) {
        await new Promise((resolve) => {
          const done = () => { window.removeListener?.('blur', done); resolve(); };
          window.once?.('blur', done);
          void delay(HANDOFF_MAX_MS).then(done);
        });
      } else if (!waitForBlur) await delay(WEB_SETTLE_MS);
      if (machine.phase !== 'launching') return false;
      machine.markRunning();
      try { hide(); } catch (error) { console.warn('Unable to hide the launcher:', error.message); }
      return true;
    },

    /** Called as soon as an exit begins (window 'close', process exit, closeActive). */
    closing() { return machine.beginClosing(); },
    finish() { return machine.finish(); },

    /** Closes the running application from any trigger (gesture, renderer, Moonlight chord watchdog). */
    async closeActive() {
      if (!machine.active || !hooks) return false;
      if (kind === 'web') { hooks.closeWebWindow(); return true; }
      if (machine.phase === 'closing') return true;
      machine.beginClosing();
      hooks.showLauncher();
      const terminated = hooks.processManager.terminate();
      if (!terminated) machine.finish();
      return terminated;
    },

    status() {
      return { phase: machine.phase, guideAvailable: guideStatus.available, guideReason: guideStatus.reason,
        overlayMode: chooseOverlayMode({ platform: hooks?.platform, env: hooks?.env, ozonePlatform: hooks?.ozonePlatform }) };
    },
    dispose() { stopWatching(); }
  };
  return controller;
}

const controller = createController();

module.exports = {
  namespace: 'session',
  handlers: {
    closeActive: () => controller.closeActive(),
    getPhase: () => controller.snapshot(),
    getStatus: () => controller.status()
  },
  start(ctx) { controller.setEmitter(ctx.emit); },
  stop() { controller.dispose(); },
  controller,
  createController,
  constants: { MIN_COVER_MS, HANDOFF_MAX_MS, WEB_SETTLE_MS, COMBO_WATCHDOG_MS }
};
