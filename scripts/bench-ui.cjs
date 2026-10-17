'use strict';

/**
 * Real-renderer UI frame-time benchmark.
 *
 *   unset ELECTRON_RUN_AS_NODE; npx electron scripts/bench-ui.cjs [--lite] [--json-only]
 *
 * Boots the actual launcher (main process + preload + renderer) in a visible 1280x800 window with an isolated
 * profile, drives the quick-settings panel and focus movement from inside the page, and records requestAnimationFrame
 * intervals, long-animation-frame / longtask entries and GPU process CPU for each scenario. Prints one JSON document.
 * Nothing leaves the machine and the real user profile is never touched. Runs for roughly 20 seconds.
 */

if (!process.versions.electron) {
  console.error('Run with Electron: unset ELECTRON_RUN_AS_NODE; npx electron scripts/bench-ui.cjs');
  process.exit(1);
}

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-bench-'));
const configPath = path.join(profile, 'config.json');
const example = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
example.settings = { ...example.settings, performance: process.argv.includes('--lite') ? 'lite' : 'quality' };
fs.writeFileSync(configPath, JSON.stringify(example, null, 2));

process.env.HOME_MEDIA_LAUNCHER_CONFIG = configPath;
// HML_BENCH_SWITCHES="--in-process-gpu --foo=bar" appends Chromium switches for A/B runs.
for (const raw of (process.env.HML_BENCH_SWITCHES || '').split(/\s+/).filter(Boolean)) {
  const [name, value] = raw.replace(/^--/, '').split('=');
  if (value === undefined) app.commandLine.appendSwitch(name); else app.commandLine.appendSwitch(name, value);
}
app.setPath('userData', profile);
// Windowed so the run is not exclusive-fullscreen; the compositor path is the same.
process.argv.push('--windowed');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// --stress emulates low-power HTPC hardware: 2x device pixels (4x fill cost) and a 4x CPU slowdown on the renderer main thread.
if (process.argv.includes('--stress')) app.commandLine.appendSwitch('force-device-scale-factor', '2');
// --uncapped removes vsync/frame-rate limiting so rAF intervals show the real per-frame pipeline cost. Use it on machines whose
// display path (virtual displays, remote capture drivers) caps presentation at ~30 fps regardless of the page.
if (process.argv.includes('--uncapped')) { app.commandLine.appendSwitch('disable-gpu-vsync'); app.commandLine.appendSwitch('disable-frame-rate-limit'); }

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Injected into the page: scenario runner. Returns plain JSON. */
const NOMINAL_OVERRIDE = process.argv.includes('--uncapped') ? 16.67 : 0;
const PAGE_RUNNER = String.raw`(() => {
  const NOMINAL_OVERRIDE = ${NOMINAL_OVERRIDE};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
  const long = { loaf: [], task: [] };
  const observe = (type, list) => { try { new PerformanceObserver((l) => { for (const e of l.getEntries()) list.push({ d: e.duration, blocking: e.blockingDuration || 0 }); }).observe({ type, buffered: false }); } catch (error) {} };
  observe('long-animation-frame', long.loaf); observe('longtask', long.task);
  let nominal = 1000 / 60;
  async function record(name, durationMs, driver) {
    const intervals = []; let last = null; let running = true;
    long.loaf.length = 0; long.task.length = 0;
    const tick = (t) => { if (last !== null) intervals.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const started = performance.now();
    await driver(durationMs);
    const rest = durationMs - (performance.now() - started);
    if (rest > 0) await sleep(rest);
    running = false; await sleep(50);
    const sorted = [...intervals].sort((a, b) => a - b);
    const total = intervals.reduce((a, b) => a + b, 0);
    const missed = intervals.reduce((a, dt) => a + Math.max(0, Math.round(dt / nominal) - 1), 0);
    const bad = intervals.filter((dt) => dt > nominal * 1.5).length;
    return {
      scenario: name, frames: intervals.length, avgMs: +(total / Math.max(1, intervals.length)).toFixed(2),
      p50Ms: +quantile(sorted, 0.5).toFixed(2), p95Ms: +quantile(sorted, 0.95).toFixed(2), p99Ms: +quantile(sorted, 0.99).toFixed(2),
      maxMs: +(sorted[sorted.length - 1] || 0).toFixed(2), droppedFramePct: +(100 * missed / Math.max(1, intervals.length + missed)).toFixed(1),
      slowFramePct: +(100 * bad / Math.max(1, intervals.length)).toFixed(1),
      over16msPct: +(100 * intervals.filter((dt) => dt > 16.9).length / Math.max(1, intervals.length)).toFixed(1),
      effectiveFps: +(1000 * intervals.length / Math.max(1, total)).toFixed(1),
      longAnimationFrames: long.loaf.length, loafMaxMs: +Math.max(0, ...long.loaf.map((e) => e.d)).toFixed(1),
      longTasks: long.task.length, longTaskMaxMs: +Math.max(0, ...long.task.map((e) => e.d)).toFixed(1)
    };
  }
  const button = () => document.querySelector('#system-button');
  const panel = () => document.querySelector('#system-panel');
  const isOpen = () => !panel().hidden && !panel().inert;
  const togglePanel = async (want) => { if (isOpen() !== want) { (button() || panel()).click(); } };
  const rows = () => [...panel().querySelectorAll('.menu-action')].filter((el) => el.offsetParent !== null);
  const focusRow = (el) => (el.querySelector('input') || el).focus({ preventScroll: true });
  const scenarios = {
    async idle(ms) { await sleep(ms); },
    async panelOpenClose(ms) {
      const end = performance.now() + ms;
      while (performance.now() < end) { await togglePanel(true); await sleep(600); await togglePanel(false); await sleep(600); }
      await togglePanel(false);
    },
    async rowFocusMove(ms) {
      await togglePanel(true); await sleep(700);
      const end = performance.now() + ms; let i = 0; let dir = 1;
      while (performance.now() < end) {
        const list = rows(); if (!list.length) break;
        i += dir; if (i >= list.length - 1 || i <= 0) dir = -dir;
        focusRow(list[Math.max(0, Math.min(list.length - 1, i))]); await sleep(140);
      }
      await togglePanel(false); await sleep(700);
    },
    async tileFocusMove(ms) {
      const tiles = [...document.querySelectorAll('.tile')];
      if (!tiles.length) { await sleep(ms); return; }
      const end = performance.now() + ms; let i = 0;
      while (performance.now() < end) { tiles[i++ % tiles.length].focus({ preventScroll: true }); await sleep(160); }
    }
  };
  return {
    async run(plan) {
      await sleep(1500);
      const warm = await record('warmup', 1200, scenarios.idle);
      nominal = NOMINAL_OVERRIDE || Math.max(4, warm.p50Ms || 16.7);
      const out = [];
      for (const [name, label, ms] of plan) out.push(await record(label, ms, scenarios[name]));
      return { nominalFrameMs: +nominal.toFixed(2), perfLite: document.body.classList.contains('perf-lite'), dpr: devicePixelRatio, results: out };
    }
  };
})()`;

app.once('browser-window-created', (_event, window) => {
  const deadline = setTimeout(() => { console.error('bench timed out'); app.exit(2); }, 60000);
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', async () => {
    try {
      window.setContentSize(1280, 800); window.show(); window.focus();
      for (let attempt = 0; attempt < 200; attempt++) {
        const ready = await window.webContents.executeJavaScript('Boolean(document.querySelector("#system-button") && document.querySelector(".tile"))');
        if (ready) break;
        await pause(50);
      }
      await pause(1000);
      if (process.argv.includes('--stress')) {
        window.webContents.debugger.attach('1.3');
        await window.webContents.debugger.sendCommand('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
      const cssArg = process.argv.find((arg) => arg.startsWith('--css='));
      if (cssArg) await window.webContents.insertCSS(fs.readFileSync(cssArg.slice(6), 'utf8')); // A/B experiments without editing the app
      const cpu = () => Object.fromEntries(app.getAppMetrics().map((m) => [`${m.type}:${m.pid}`, m.cpu.cumulativeCPUUsage]));
      const gpuBefore = cpu();
      const t0 = Date.now();
      const plan = [['idle', 'idle', 2500], ['panelOpenClose', 'panel open/close', 6000], ['rowFocusMove', 'row focus move (panel open)', 4000], ['tileFocusMove', 'tile focus move', 3000]];
      const report = await window.webContents.executeJavaScript(`${PAGE_RUNNER}.run(${JSON.stringify(plan)})`);
      const shotArg = process.argv.find((arg) => arg.startsWith('--shot='));
      if (shotArg) { // Visual check: panel open with the last row focused, saved as PNG (e.g. --shot=panel.png).
        await window.webContents.executeJavaScript(`(async () => { document.querySelector('#system-button').click(); await new Promise((r) => setTimeout(r, 900)); const rows = [...document.querySelectorAll('#system-panel .menu-action')].filter((el) => el.offsetParent); (rows.at(-1).querySelector('input') || rows.at(-1)).focus(); await new Promise((r) => setTimeout(r, 700)); })()`);
        fs.writeFileSync(shotArg.slice(7), (await window.webContents.capturePage()).toPNG());
      }
      const wallSeconds = (Date.now() - t0) / 1000;
      const gpuAfter = cpu();
      const processes = app.getAppMetrics().map((m) => ({
        type: m.type, name: m.name || undefined, avgCpuPct: +(100 * ((m.cpu.cumulativeCPUUsage - (gpuBefore[`${m.type}:${m.pid}`] || 0)) / wallSeconds)).toFixed(1),
        workingSetMB: Math.round((m.memory.workingSetSize || 0) / 1024)
      }));
      void gpuAfter;
      const gpuInfo = await app.getGPUInfo('basic').catch(() => null);
      const output = {
        electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform,
        gpuFeatureStatus: app.getGPUFeatureStatus(), gpuDevice: gpuInfo?.gpuDevice?.[0] ? { vendorId: gpuInfo.gpuDevice[0].vendorId, deviceId: gpuInfo.gpuDevice[0].deviceId, driver: gpuInfo.gpuDevice[0].driverVersion } : null,
        ...report, processes
      };
      console.log(JSON.stringify(output, null, 2));
      clearTimeout(deadline);
      app.exit(0);
    } catch (error) {
      console.error('bench failed:', error);
      app.exit(1);
    }
  });
});

process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (error) { /* temp profile cleanup is best effort */ } });

// The real main process: creates the window, registers IPC and starts every backend service.
require(path.join(root, 'src', 'main', 'index.js'));
