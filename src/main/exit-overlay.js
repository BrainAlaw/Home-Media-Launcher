'use strict';

const path = require('node:path');

const OVERLAY_SIZE = { width: 640, height: 200 };
const LOAD_TIMEOUT_MS = 1500;

/**
 * Wayland clients cannot force themselves above other toplevels, so a native Wayland Electron session gets no overlay;
 * the caller then closes the application directly (and reports it with a toast on return).
 * @returns {'overlay' | 'direct'}
 */
function chooseOverlayMode({ platform = process.platform, env = process.env, ozonePlatform = '' } = {}) {
  if (platform !== 'linux') return 'overlay';
  const sessionIsWayland = env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY);
  // Recent Electron defaults to the native Wayland backend inside a Wayland session unless X11 is forced.
  const nativeWayland = ozonePlatform === 'wayland' || (ozonePlatform !== 'x11' && sessionIsWayland);
  return nativeWayland ? 'direct' : 'overlay';
}

/**
 * Small transparent always-on-top glass window ("Close <app>?" with a progress ring) shown over a native application.
 * It never takes focus and ignores the mouse. Created on first use, kept hidden between holds, destroyed with the session.
 */
class ExitOverlay {
  constructor({ BrowserWindow, screen, mode = 'overlay' }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.mode = mode;
    this.win = null;
    this.ready = null;
    this.visible = false;
    this.failed = false;
    this.name = '';
  }

  get usable() { return this.mode === 'overlay' && !this.failed; }

  /** Resolves true when the overlay is actually on screen and above other windows. */
  async show(name) {
    if (!this.usable) return false;
    this.name = name;
    this.wanted = true;
    try {
      if (!this.win || this.win.isDestroyed()) this.ready = this.create();
      if (!(await this.ready)) return false;
      if (!this.wanted) return false;
      this.push(0);
      if (!this.visible) {
        this.win.setAlwaysOnTop(true, 'screen-saver');
        this.win.showInactive();
        this.visible = this.win.isVisible() && this.win.isAlwaysOnTop();
        if (!this.visible) this.markFailed();
      }
      return this.visible;
    } catch {
      this.markFailed();
      return false;
    }
  }

  update(progress) {
    if (this.visible) this.push(progress);
  }

  hide() {
    this.wanted = false;
    if (!this.win || this.win.isDestroyed() || !this.visible) return;
    this.visible = false;
    this.win.hide();
  }

  destroy() {
    this.visible = false;
    this.ready = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  markFailed() {
    this.failed = true;
    this.destroy();
  }

  push(progress) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('exit-overlay:state', { name: this.name, progress });
  }

  async create() {
    const { bounds } = this.screen.getPrimaryDisplay();
    const win = new this.BrowserWindow({
      x: Math.round(bounds.x + (bounds.width - OVERLAY_SIZE.width) / 2),
      y: Math.round(bounds.y + bounds.height * 0.62),
      ...OVERLAY_SIZE,
      frame: false, transparent: true, hasShadow: false, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, show: false, alwaysOnTop: true, backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    this.win = win;
    win.setIgnoreMouseEvents(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    const loaded = win.loadFile(path.join(__dirname, '../renderer/exit-overlay.html')).then(() => true, () => false);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(false), LOAD_TIMEOUT_MS).unref?.());
    const ok = await Promise.race([loaded, timeout]);
    if (!ok) this.markFailed();
    return ok;
  }
}

module.exports = { ExitOverlay, chooseOverlayMode };
