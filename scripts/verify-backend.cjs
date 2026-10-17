'use strict';

// Run with Node.js. The child executes the real Electron main process and preload.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

if (process.versions.electron) {
  const assert = require('node:assert/strict');
  const { app, BrowserWindow } = require('electron');
  // Keep IPC verification hardware-free: OS adapters are covered with fake commands/sysfs in unit tests.
  const { ControllerSession } = require('../src/main/controller-session');
  const { LinuxControllerHardware } = require('../src/main/controller-hardware');
  const probeController = { id: 'AA:BB:CC:DD:EE:FF', name: 'Xbox IPC Probe', transport: 'usb', battery: 71, charging: false, connected: true };
  let controllerBackend;
  ControllerSession.prototype.readStatus = async function readStatus() {
    controllerBackend = this;
    const controllers = [{ ...probeController }]; this.acceptControllers(controllers);
    return { platform: this.platform, supported: true, message: '', controllers };
  };
  ControllerSession.prototype.command = async () => ({ stdout: '{"Present":false}' });
  LinuxControllerHardware.prototype.dongles = async () => ({ present: false, driver: null, pairingSupported: false, interfaces: [] });
  app.setPath('userData', process.env.VIBEPOLLO_VERIFY_DIRECTORY);
  // Verify the real webContents and preload without interrupting the desktop.
  BrowserWindow.prototype.show = function show() {};
  const deadline = setTimeout(() => { console.error('Electron verification timed out'); app.exit(1); }, 15000);
  app.once('browser-window-created', (_event, window) => {
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(`(async () => {
          const model = await launcher.getModel();
          const controllerStatus = await launcher.getControllerStatus();
          const connectedGamepads = await launcher.getConnectedGamepads();
          const dongleStatus = await launcher.getDongleStatus();
          const controllerEvents = [];
          const stopControllerEvents = [
            launcher.onDeviceFound((value) => controllerEvents.push(['found', value])),
            launcher.onPairingSuccess((value) => controllerEvents.push(['success', value])),
            launcher.onPairingError((value) => controllerEvents.push(['error', value])),
            launcher.onBatteryUpdate((value) => controllerEvents.push(['battery', value])),
            launcher.onControllersChanged((value) => controllerEvents.push(['controllers', value])),
            launcher.onControllerPairingUpdate((value) => controllerEvents.push(['aggregate', value]))
          ];
          const invalidPair = await launcher.pairController('invalid; command');
          const controllerStart = await launcher.startControllerPairing('usb');
          const controllerCancel = await launcher.cancelControllerPairing();
          window.__controllerEvents = controllerEvents;
          window.__stopControllerEvents = () => stopControllerEvents.forEach((stop) => stop());
          const controllerMethods = ['unblockBluetooth', 'startDonglePairing'].every((name) => typeof launcher[name] === 'function');
          const updated = await launcher.setIconOverride('custom:probe', ${JSON.stringify('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRusAAAAASUVORK5CYII=')});
          let denied = false;
          try { await launcher.launch('unknown-id'); } catch { denied = true; }
          const available = await launcher.getAvailableThemes();
          const { assets, unavailableAssets, ...baseTheme } = await launcher.getCurrentTheme();
          let themeEvents = 0;
          const unsubscribe = launcher.onThemeChanged(() => themeEvents++);
          const theme = { ...baseTheme, id: 'verification', name: 'Verification', background: { type: 'image', source: ${JSON.stringify(path.join(process.env.VIBEPOLLO_VERIFY_DIRECTORY, 'background.png'))} } };
          await launcher.saveCustomTheme(theme);
          const active = await launcher.setTheme(theme.id);
          unsubscribe();
          const response = await fetch(active.assets.background, { headers: { Range: 'bytes=0-7' } });
          const signature = Array.from(new Uint8Array(await response.arrayBuffer()));
          await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error('Protocol image failed to decode')); image.src = active.assets.background; });
          let background;
          for (let attempt = 0; attempt < 100; attempt++) {
            background = await launcher.getAppBackground('custom:probe');
            if (background.state === 'ready') break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          const timings = [];
          for (let index = 0; index < 200; index++) {
            const start = performance.now();
            await launcher.getAppBackground('custom:probe');
            timings.push(performance.now() - start);
          }
          timings.sort((a, b) => a - b);
          const menu = await launcher.getMenuConfiguration();
          let slideshow;
          for (let attempt = 0; attempt < 200; attempt++) {
            slideshow = await launcher.getSlideshowState();
            if (slideshow.slides.slice(0, 5).every((slide) => slide.memory === 'full')) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          const menuTimings = [];
          const localTimings = [];
          await launcher.getAppBackgrounds();
          for (let index = 0; index < 200; index++) {
            let start = performance.now();
            await launcher.getMenuIndicators();
            menuTimings.push(performance.now() - start);
            start = performance.now();
            launcher.getCachedMenuIndicators();
            launcher.getCachedAppBackground('custom:probe');
            localTimings.push(performance.now() - start);
          }
          menuTimings.sort((a, b) => a - b); localTimings.sort((a, b) => a - b);
          for (let index = 0; index < 1000; index++) launcher.hintNavigation({ appId: 'custom:probe', slideshowIndex: index % slideshow.slides.length });
          launcher.hintNavigation({ appId: null, slideshowIndex: 0 });
          const videoTheme = { ...theme, id: 'verification-video', background: { type: 'video', source: ${JSON.stringify(path.join(process.env.VIBEPOLLO_VERIFY_DIRECTORY, 'loop.mp4'))} } };
          const video = await launcher.saveCustomTheme(videoTheme);
          const suffix = await fetch(video.assets.background, { headers: { Range: 'bytes=-4' } });
          return { controllerStatus, connectedGamepads, dongleStatus, invalidPair, controllerStart, controllerCancel, controllerMethods, status: model.remoteStatus.status, icon: updated.rows[0].tiles[0].icon, denied, themeCount: available.length, themeEvents, activeId: active.id, signature, rangeStatus: response.status, background, ipcP95: timings[190], videoSuffix: await suffix.text(), videoStatus: suffix.status, menu, slideshow, menuP95: menuTimings[190], localP95: localTimings[190] };
        })()`);
        assert.equal(result.status, 'disabled');
        assert.deepEqual(result.controllerStatus, result.connectedGamepads);
        assert.equal(result.controllerStatus.controllers[0].battery, 71);
        assert.equal(result.controllerMethods, true);
        assert.equal(result.dongleStatus.pairingSupported, false);
        assert.equal(result.invalidPair.success, false);
        assert.equal(result.invalidPair.code, 'UNKNOWN');
        assert.equal(result.controllerStart.state, 'scanning');
        assert.deepEqual(result.controllerStart.devices, []);
        assert.equal(result.controllerCancel.cancelled, true);
        controllerBackend.event('device-found', probeController);
        controllerBackend.event('pairing-success', probeController);
        controllerBackend.acceptControllers([{ ...probeController, battery: 70 }]);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const controllerEvents = await window.webContents.executeJavaScript('window.__controllerEvents');
        for (const name of ['found', 'success', 'error', 'battery', 'controllers', 'aggregate']) assert.ok(controllerEvents.some(([event]) => event === name), `Missing controller IPC event: ${name}`);
        await window.webContents.executeJavaScript('window.__stopControllerEvents()');
        controllerBackend.event('battery-update', { id: probeController.id, battery: 69, charging: false });
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(await window.webContents.executeJavaScript('window.__controllerEvents.length'), controllerEvents.length);
        assert.ok(result.icon.startsWith('file:'));
        assert.equal(result.denied, true);
        assert.ok(result.themeCount > 0);
        assert.ok(result.themeEvents >= 2);
        assert.equal(result.activeId, 'verification');
        assert.equal(result.rangeStatus, 206);
        assert.deepEqual(result.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.equal(result.background.state, 'ready');
        assert.equal(result.videoStatus, 206);
        assert.equal(result.videoSuffix, 'tail');
        console.log(`Warm artwork IPC p95: ${result.ipcP95.toFixed(3)} ms (200 requests, local Windows run).`);
        assert.ok(result.ipcP95 < 16, 'Warm artwork IPC exceeded the 16 ms target in this run');
        assert.equal(result.menu.layout, 'top-bar');
        assert.equal(result.slideshow.slides.slice(0, 5).filter((slide) => slide.memory === 'full').length, 5);
        console.log(`Menu indicator IPC p95: ${result.menuP95.toFixed(3)} ms; two preload-local reads p95: ${result.localP95.toFixed(3)} ms (200 samples).`);
        const originalImage = path.join(process.env.VIBEPOLLO_VERIFY_DIRECTORY, 'background.png');
        await fs.rename(originalImage, `${originalImage}.hidden`);
        const fromMemory = await window.webContents.executeJavaScript(`fetch(${JSON.stringify(result.slideshow.slides[0].url)}).then((response) => response.arrayBuffer()).then((body) => new Uint8Array(body)[0])`);
        assert.equal(fromMemory, 137);
        const outsider = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../src/main/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
        await outsider.loadURL('data:text/html,<html><body>Untrusted window</body></html>');
        const denied = await outsider.webContents.executeJavaScript('(async () => { try { await launcher.getSettings(); return false; } catch (error) { return error.message.includes("Untrusted IPC sender"); } })()');
        assert.equal(denied, true);
        const webSession = new BrowserWindow({ show: false, webPreferences: { partition: 'verification-web-app', sandbox: true, contextIsolation: true, nodeIntegration: false } });
        assert.equal(await webSession.webContents.session.protocol.isProtocolHandled('vibepollo-media'), false);
        console.log('Electron backend verification passed: controller methods/events/unsubscribe, model, icons, theme save/select/events, CSP media image loading, video byte ranges, artwork IPC, untrusted IPC rejection.');
        clearTimeout(deadline);
        app.exit(0);
      } catch (error) {
        console.error(error);
        clearTimeout(deadline);
        app.exit(1);
      }
    });
  });
  require('../src/main/index');
} else {
  async function verify() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-electron-'));
    try {
      const configPath = path.join(directory, 'config.json');
      const image = path.join(directory, 'background.png');
      await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRusAAAAASUVORK5CYII=', 'base64'));
      const slides = [{ type: 'image', source: image }];
      for (let index = 1; index < 5; index++) {
        const source = path.join(directory, `next-${index}.png`);
        await fs.copyFile(image, source);
        slides.push({ type: 'image', source });
      }
      const video = await fs.open(path.join(directory, 'loop.mp4'), 'w');
      await video.truncate(32 * 1024 * 1024);
      await video.write(Buffer.from('tail'), 0, 4, 32 * 1024 * 1024 - 4);
      await video.close();
      await fs.writeFile(configPath, JSON.stringify({ menu: { version: 1, layout: 'top-bar', groups: [], slideshow: { enabled: true, lookAhead: 4, assets: slides } }, settings: { scanDesktopEntries: false }, rows: [{ title: 'Probe', tiles: [{ id: 'custom:probe', name: 'Probe', command: process.execPath, hero_image: image }] }] }));
      const env = { ...process.env, VIBEPOLLO_VERIFY_DIRECTORY: directory, HOME_MEDIA_LAUNCHER_CONFIG: configPath };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Electron verification failed (${code})`)));
      });
    } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  }
  verify().catch((error) => { console.error(error); process.exitCode = 1; });
}
