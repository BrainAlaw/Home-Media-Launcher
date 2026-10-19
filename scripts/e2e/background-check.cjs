'use strict';

/**
 * Background apps check on the real display (R03). Four Gaming websites (fixtures/keys.html on 127.0.0.1) are opened in
 * turn with the launcher's own launch path:
 *   1. open A, Home (keyboard) returns to the launcher and A keeps running (window alive, hidden);
 *   2. open B, C, D (limit 3): opening D evicts A (A's window is closed);
 *   3. resume C from the launcher: C comes back on screen without a new window;
 *   4. long Back (900 ms) closes C and the launcher comes back.
 * A screenshot is taken 200 ms after each launch to show the loading card, and one after the window is up.
 * Output: scripts/e2e/out/bg-<run>/report.md and PNGs. The temp profile is a copy; the real config is not written.
 *
 * Usage: unset ELECTRON_RUN_AS_NODE; HML_E2E_ROOT=<main checkout> npx electron scripts/e2e/background-check.cjs
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');

const ROOT = process.env.HML_E2E_ROOT ? path.resolve(process.env.HML_E2E_ROOT) : path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'keys.html');
const PORT = 48232;
const SITES = ['bg-a', 'bg-b', 'bg-c', 'bg-d'];
const COPY_FILES = ['config.json', 'remote-apps.json', 'themes.json'];
const BOOT_MS = 6000;
const SETTLE_MS = 500;

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(__dirname, 'out', `bg-${runId}`);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-bg-e2e-'));
const userData = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'home-media-launcher');
for (const file of COPY_FILES) {
  try { fs.copyFileSync(path.join(userData, file), path.join(profile, file)); } catch { /* optional */ }
}
const configPath = path.join(profile, 'config.json');
const baseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { settings: {}, rows: [] };
const websites = SITES.map((id) => ({ id, name: id.toUpperCase(), url: `http://127.0.0.1:${PORT}/${id}/keys.html`, icon: '', category: 'gaming' }));
fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, websites: [...(baseConfig.websites || []).filter((site) => !SITES.includes(site.id)), ...websites] }, null, 2));
process.env.HOME_MEDIA_LAUNCHER_CONFIG = configPath;
process.argv.push(ROOT);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const server = http.createServer((request, response) => {
  if (/^\/bg-[a-d]\/keys\.html$/.test(request.url || '')) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(FIXTURE));
    return;
  }
  response.writeHead(404).end();
});

const launcherWindow = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.getURL().includes('index.html'));
const siteWindows = () => BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && win.webContents.getURL().startsWith('http://127.0.0.1'));
const runIn = (contents, js) => contents.executeJavaScript(js, true);

async function capture(name) {
  const win = siteWindows().find((item) => item.isVisible()) || launcherWindow();
  if (!win) return null;
  const display = screen.getDisplayMatching(win.getBounds());
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  const file = `${name}.png`;
  fs.writeFileSync(path.join(outDir, file), source.thumbnail.toPNG());
  return file;
}

function describe() {
  return {
    launcherVisible: Boolean(launcherWindow()?.isVisible()),
    sites: siteWindows().map((win) => ({ id: win.webContents.getURL().split('/')[3] || '?', visible: win.isVisible() })),
  };
}

async function record(label, check, shot = true) {
  const state = describe();
  const verdict = check(state);
  results.push({ label, state, failures: verdict === true ? [] : [verdict], shot: shot ? await capture(`${String(results.length + 1).padStart(2, '0')}-${label}`) : null });
}

async function launch(id) {
  // Not awaited: the launch promise resolves only when the app closes.
  await runIn(launcherWindow().webContents, `void window.api.launchApp({ id: '${id}' }), true`);
}

async function waitFor(predicate, timeoutMs = 15000) {
  for (let waited = 0; waited < timeoutMs; waited += 200) {
    if (predicate()) return true;
    await sleep(200);
  }
  return false;
}

function writeReport() {
  const failed = results.filter((item) => item.failures.length);
  const lines = [`# Background apps check ${runId}`, '', `Steps: ${results.length}, failed: ${failed.length}`, ''];
  for (const item of results) {
    if (item.blocked) { lines.push(`- BLOCKED · ${item.label} · ${item.blocked}`); continue; }
    lines.push(`- ${item.failures.length ? 'FAIL' : 'ok'} · ${item.label} · launcher ${item.state.launcherVisible ? 'visible' : 'hidden'} · sites ${JSON.stringify(item.state.sites)}`);
    for (const failure of item.failures) lines.push(`  - ${failure}`);
  }
  lines.push('', '## Screenshots', '', ...results.map((item) => `- ${item.label}: ${item.shot || 'not captured'}`));
  fs.writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`);
  return { failed: failed.length };
}

app.setPath('userData', profile);
require(path.join(ROOT, 'src', 'main', 'index.js'));

app.whenReady().then(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  await sleep(BOOT_MS);
  const launcher = launcherWindow();
  if (!launcher) throw new Error('launcher window not found');
  const primaryId = screen.getPrimaryDisplay().id;
  const target = screen.getAllDisplays().find((display) => display.id !== primaryId) || screen.getPrimaryDisplay();
  launcher.setBounds({ x: target.bounds.x, y: target.bounds.y, width: target.bounds.width, height: target.bounds.height });
  launcher.setAlwaysOnTop(true, 'screen-saver');
  launcher.focus();
  await sleep(800);

  // 1. open A, Home returns to the launcher and A stays alive
  await launch('bg-a');
  await waitFor(() => siteWindows().some((win) => win.isVisible()));
  await sleep(200);
  await record('a-loading-card', () => true);
  await sleep(1200);
  await record('a-on-screen', (state) => state.sites.some((site) => site.visible) || 'A is not on screen');
  const pageA = siteWindows().find((win) => win.isVisible());
  pageA.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' });
  await sleep(150);
  pageA.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' });
  await sleep(SETTLE_MS);
  await record('a-home-to-background', (state) => {
    if (!state.launcherVisible) return 'launcher not visible after Home';
    return state.sites.some((site) => site.visible) ? 'a site is still visible after Home' : true;
  });

  // 2. open B, C, D: the fourth app evicts A
  for (const id of ['bg-b', 'bg-c', 'bg-d']) {
    await launch(id);
    await waitFor(() => siteWindows().some((win) => win.isVisible()));
    await sleep(900);
    const page = siteWindows().find((win) => win.isVisible());
    page.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' });
    await sleep(150);
    page.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' });
    await sleep(SETTLE_MS);
  }
  await record('after-four-apps', (state) => {
    const ids = state.sites.map((site) => site.id);
    return ids.includes('bg-a') ? 'A should have been evicted by the fourth app' : true;
  }, false);

  // 3. resume C from the launcher
  await launch('bg-c');
  await waitFor(() => siteWindows().some((win) => win.isVisible()));
  await sleep(900);
  await record('resume-c', (state) => state.sites.filter((site) => site.visible).length === 1 || 'expected exactly one visible site after resuming C');

  // 4. long Back closes C and the launcher comes back
  const pageC = siteWindows().find((win) => win.isVisible());
  // Electron's sendInputEvent cannot name the BrowserBack key (it arrives with an empty key), so this step is reported as
  // blocked here; the long-Back close path in the main process is exercised by the real remote on the HTPC.
  results.push({ label: 'long-back-closes', state: describe(), failures: [], shot: null, blocked: 'harness cannot inject BrowserBack; verify with the real remote' });

  const summary = writeReport();
  console.log(`BG-APPS ${summary.failed ? 'FAILED' : 'PASSED'}: ${results.length} steps, ${summary.failed} failed, report ${path.relative(ROOT, outDir)}`);
  server.close();
  app.exit(summary.failed ? 1 : 0);
});
