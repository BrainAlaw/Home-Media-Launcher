'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

if (process.versions.electron) {
  const assert = require('node:assert/strict');
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', process.env.VIBEPOLLO_MENU_PROFILE);
  // Real compositor frames and Gamepad API polling require a visible Electron surface.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  const output = process.env.VIBEPOLLO_MENU_OUTPUT;
  const deadline = setTimeout(() => { console.error('Menu verification timed out'); app.exit(1); }, 25000);
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  app.once('browser-window-created', (_event, window) => {
    window.webContents.on('console-message', (details) => { if (details.level === 'error' || details.level === 3) console.error('Renderer:', details.message); });
    window.webContents.setBackgroundThrottling(false);
    window.setContentSize(1280, 800);
    const run = async (code) => {
      try { return await window.webContents.executeJavaScript(code); }
      catch (error) { console.error('Renderer evaluation failed:', code.slice(0, 180)); throw error; }
    };
    const key = async (name) => {
      window.focus(); window.webContents.focus();
      // Windows foreground activation is asynchronous; wait before native input injection.
      await pause(35);
      if (name === 'ContextMenu') {
        await run('window.__menuPad.buttons[9].pressed = true'); await pause(50);
        await run('window.__menuPad.buttons[9].pressed = false'); await pause(45);
        return;
      }
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: name });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: name });
      await pause(45);
    };
    const screenshot = async (name) => fs.writeFile(path.join(output, name), (await window.webContents.capturePage()).toPNG());
    window.webContents.once('did-finish-load', async () => {
      try {
        await fs.mkdir(output, { recursive: true });
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await run('Boolean(document.querySelector(".navigation-tab") && document.querySelector(".tile"))')) break;
          await pause(25);
        }
        assert.equal(await run('typeof window.NavigationMenu.MenuController'), 'function');
        await pause(700);
        const appearance = await run(`(() => { const s = getComputedStyle(document.querySelector('.tile')); return [s.width, s.borderRadius, s.fontFamily, s.backgroundColor]; })()`);
        window.webContents.focus();
        await run(`document.querySelector('[data-menu-id="home"]').focus()`);
        await key('Right');
        assert.equal(await run('document.activeElement.dataset.menuId'), 'games');
        await pause(200);
        assert.equal(await run('document.querySelector("[aria-selected=true]").dataset.menuId'), 'games');
        assert.equal(await run('[...document.querySelectorAll("#rows .tile")].every((tile) => tile.dataset.tileId.startsWith("game"))'), true);
        await key('Right'); await key('Right'); await key('Left');
        await pause(200);
        assert.equal(await run('document.querySelector("[aria-selected=true]").dataset.menuId'), 'apps');
        await key('Down');
        assert.equal(await run('document.activeElement.classList.contains("tile")'), true);
        await key('Escape');
        assert.equal(await run('document.activeElement.dataset.menuId'), 'apps');
        await run(`document.querySelector('[data-menu-id="home"]').click()`);
        await pause(200);
        const unchanged = await run(`(() => { const s = getComputedStyle(document.querySelector('.tile')); return [s.width, s.borderRadius, s.fontFamily, s.backgroundColor]; })()`);
        assert.deepEqual(unchanged, appearance);
        // Drive the real Gamepad API polling loop rather than invoking a controller method.
        await run(`window.__menuPad = { index: 0, connected: true, buttons: Array.from({length: 17}, () => ({pressed: false})), axes: [0, 0] }; Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { window.__padPolls = (window.__padPolls || 0) + 1; return [window.__menuPad]; } });`);
        await pause(50);
        await run('window.__menuPad.buttons[15].pressed = true'); await pause(65);
        await run('window.__menuPad.buttons[15].pressed = false'); await pause(200);
        assert.equal(await run('document.activeElement.dataset.menuId'), 'games');
        // System focus must not wait for the asynchronous autostart query.
        await key('ContextMenu');
        assert.equal(await run('document.activeElement.id'), 'settings-button');
        assert.equal(await run('document.querySelector("main").inert'), true);
        await pause(500);
        await key('Down'); assert.equal(await run('document.activeElement.id'), 'autostart');
        await key('Down'); assert.equal(await run('document.activeElement.id'), 'quit-button');
        await key('Escape');
        await pause(650);
        assert.equal(await run('document.querySelector("#system-panel").hidden'), true);
        assert.equal(await run('document.querySelector("main").inert'), false);
        // Cancellation of an opening sheet must not hide a subsequently reopened sheet.
        await key('ContextMenu'); await key('Escape'); await key('ContextMenu'); await pause(500);
        assert.equal(await run('document.querySelector("#system-panel").hidden'), false);
        await key('Return'); await pause(100);
        assert.equal(await run('document.querySelector("#settings-dialog").open'), true);
        await key('Escape'); await pause(100);
        assert.equal(await run('document.querySelector("#settings-dialog").open'), false);
        assert.equal(await run('document.querySelector("#system-button").getAttribute("aria-expanded")'), 'false');
        // Verify background crossfades while the menu's geometry remains fixed.
        const fade = await run(`(async () => {
          const menu = document.querySelector('#primary-navigation'); const before = menu.getBoundingClientRect().toJSON();
          const sources = window.WALLPAPER_ENTRIES.slice(0, 2).map((entry) => new URL(entry.file, document.baseURI).href);
          await showBackdrop({ type: 'image', source: sources[0], art: false });
          await new Promise((resolve) => setTimeout(resolve, 30));
          await showBackdrop({ type: 'image', source: sources[1], art: false });
          return { before, after: menu.getBoundingClientRect().toJSON(), visible: document.querySelectorAll('.backdrop-layer.on').length, clip: getComputedStyle(menu).overflowX };
        })()`);
        assert.deepEqual(fade.after, fade.before);
        assert.equal(fade.visible, 1);
        await pause(700);
        const baseline = await run(`new Promise((resolve) => {
          const times = []; let last; const loop = (time) => { if(last !== undefined) times.push(time-last); last=time;
            if(times.length < 30) requestAnimationFrame(loop); else { times.sort((a,b)=>a-b); resolve(times[28]); }
          }; requestAnimationFrame(loop);
        })`);
        if (process.env.VIBEPOLLO_MENU_NO_BLUR) await run(`document.querySelector('#primary-navigation').style.setProperty('--menu-backdrop-filter', 'none')`);
        // Springs use a fixed small integration step; live rendering is measured at the display's refresh rate.
        const timings = await run(`new Promise((resolve) => {
          const variant = ${JSON.stringify(process.env.VIBEPOLLO_MENU_VARIANT || 'menu')};
          if (variant === 'control') navigationMenu.motion.setReducedMotion(true);
          const control = variant === 'control' ? document.body.appendChild(document.createElement('div')) : null;
          if (control) control.style.cssText = 'position:fixed;z-index:100;left:4px;top:4px;width:8px;height:8px;background:white;will-change:transform;pointer-events:none';
          const times = []; const focusWork = []; let last; let frame = 0; let nativeAnimations = 0;
          const loop = (time) => { if (last !== undefined) times.push(time - last); last = time;
            if (control) control.style.transform = 'translate3d(' + Math.sin(frame*.1)*3 + 'px,0,0)';
            else if (frame % 8 === 0) { const started = performance.now(); navigationMenu.buttons[Math.floor(frame / 8) % navigationMenu.buttons.length].focus({preventScroll:true}); focusWork.push(performance.now()-started); }
            nativeAnimations = Math.max(nativeAnimations, document.getAnimations().filter((animation) => animation.effect?.target?.closest?.('#primary-navigation, #system-panel, #system-button')).length);
            if (++frame < 90) requestAnimationFrame(loop); else { control?.remove(); times.sort((a,b)=>a-b); focusWork.sort((a,b)=>a-b); resolve({p95: times[Math.floor(times.length*.95)], max: times.at(-1), count: times.length, nativeAnimations, focusP95: focusWork[Math.floor(focusWork.length*.95)] || 0}); }
          }; requestAnimationFrame(loop);
        })`);
        const gpu = app.getGPUFeatureStatus();
        const gpuInfo = await app.getGPUInfo('complete');
        const display = require('electron').screen.getDisplayMatching(window.getBounds());
        console.log(`RAF p95: idle ${baseline.toFixed(2)} ms; ${process.env.VIBEPOLLO_MENU_VARIANT || 'menu'} ${timings.p95.toFixed(2)} ms, max ${timings.max.toFixed(2)} ms (${timings.count} intervals); focus setup p95 ${timings.focusP95.toFixed(3)} ms; ${timings.nativeAnimations} native animation effects. Display ${display.displayFrequency} Hz; GPU compositor ${gpu.gpu_compositing}.`);
        console.log('Graphics renderer:', gpuInfo.auxAttributes?.glRenderer, 'software:', gpuInfo.auxAttributes?.softwareRendering);
        await run('navigationMenu.motion.setReducedMotion(true); navigationMenu.move("left")');
        assert.equal(await run('navigationMenu.motion.motions.size'), 0);
        assert.equal(await run(`document.getAnimations().filter((animation) => animation.effect?.target?.closest?.('#primary-navigation, #system-panel, #system-button')).length`), 0);
        // Capture visual artifacts after timing so GPU readbacks cannot distort the motion sample.
        await run(`document.querySelector('[data-menu-id="home"]').click()`); await pause(250);
        await screenshot('home.png');
        await key('ContextMenu'); await pause(200); await screenshot('system.png'); await key('Escape');
        for (const [width, height] of [[1920, 1080], [768, 720], [480, 740]]) {
          window.setContentSize(width, height); await pause(130);
          const layout = await run(`(() => { const nav = document.querySelector('#primary-navigation').getBoundingClientRect(); const gear = document.querySelector('#system-button').getBoundingClientRect(); return { left: nav.left, right: nav.right, top: nav.top, bottom: nav.bottom, gearLeft: gear.left, gearBottom: gear.bottom, width: innerWidth }; })()`);
          assert.ok(layout.left >= 0 && layout.right <= layout.width + 1, JSON.stringify(layout));
          assert.ok(layout.right <= layout.gearLeft || layout.top >= layout.gearBottom, 'Menu overlaps the system control');
          await screenshot(`menu-${width}.png`);
        }
        console.log(`Menu verification passed: keyboard, real gamepad polling, filtering, focus restoration, rapid reversal, sheet cancellation, dialog, reduced motion and slideshow geometry. Screenshots: ${output}`);
        clearTimeout(deadline); app.exit(0);
      } catch (error) { console.error(error); clearTimeout(deadline); app.exit(1); }
    });
  });
  require('../src/main/index');
} else {
  async function verify() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vibepollo-menu-test-'));
    try {
      const configPath = path.join(directory, 'config.json');
      const items = [
        { id: 'home', label: 'Home', action: 'home' },
        { id: 'games', label: 'Games', action: 'category', category: 'Games' },
        { id: 'apps', label: 'Apps', action: 'category', category: 'Apps' },
        { id: 'web', label: 'Web', action: 'category', category: 'Web Apps' }
      ];
      const tiles = [
        { id: 'game-one', name: 'Assetto Corsa', command: process.execPath, remote: true },
        { id: 'game-two', name: 'Forza Horizon', command: process.execPath, remote: true },
        { id: 'game-three', name: 'Hades II', command: process.execPath, remote: true },
        { id: 'app-one', name: 'Media Player', command: process.execPath }
      ];
      await fs.writeFile(configPath, JSON.stringify({
        menu: { version: 1, layout: 'top-bar', groups: [{ id: 'main', label: 'Main', items }] },
        settings: { scanDesktopEntries: false, theme: { preset: 'console', dynamicArt: false }, wallpaper: { mode: 'bundled', id: 'sea-sunset' }, header: { showText: false, showDate: true, showTime: true } },
        rows: [{ title: 'Games', tiles }], websites: [{ id: 'web-one', name: 'YouTube', url: 'https://www.youtube.com/tv' }]
      }));
      const output = process.env.VIBEPOLLO_MENU_OUTPUT || path.join(os.tmpdir(), 'vibepollo-menu-preview');
      const env = { ...process.env, VIBEPOLLO_MENU_PROFILE: directory, VIBEPOLLO_MENU_OUTPUT: output, HOME_MEDIA_LAUNCHER_CONFIG: configPath };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [__filename, '--windowed'], { env, stdio: 'inherit', windowsHide: true });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Menu verification failed (${code})`))); });
    } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  }
  verify().catch((error) => { console.error(error); process.exitCode = 1; });
}
