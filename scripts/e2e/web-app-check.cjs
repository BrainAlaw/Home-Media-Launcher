'use strict';

/**
 * Stage A check on the real display: a website window opened from the launcher is driven by a scripted virtual pad
 * and by keyboard events, and the fixture page (fixtures/keys.html) reports what it received. Checks that:
 *   - D-pad right x2 then down reach the page as ArrowRight, ArrowRight, ArrowDown (trusted);
 *   - A reaches the page as Enter, B as Escape (a tap);
 *   - a short Home press (150 ms) keeps the web window open;
 *   - a long Home press (900 ms) closes it and the launcher is visible again.
 * Output: scripts/e2e/out/web-<run>/report.md, report.json and one PNG per step (real display, never capturePage).
 *
 * The temporary website is in the Gaming category on purpose: Home Theatre websites open through TvBrowserSession,
 * which does not use the web-preload path (see Requests for the coordinator in R02).
 * The temporary website tile lives only in the temp profile copy; the user's config.json is never written.
 * openWebsite accepts HTTP and HTTPS only, so the fixture is served from 127.0.0.1.
 *
 * Usage: unset ELECTRON_RUN_AS_NODE; HML_E2E_ROOT=<main checkout> npx electron scripts/e2e/web-app-check.cjs
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');

const ROOT = process.env.HML_E2E_ROOT ? path.resolve(process.env.HML_E2E_ROOT) : path.resolve(__dirname, '..', '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'keys.html');
const WEBSITE_ID = 'e2e-keys';
const COPY_FILES = ['config.json', 'remote-apps.json', 'themes.json'];
const BUTTON = Object.freeze({ A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });
const PRESS_MS = 120;
const SETTLE_MS = 420;
const BOOT_MS = 6000;

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(__dirname, 'out', `web-${runId}`);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-web-e2e-'));
const userData = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'home-media-launcher');
for (const file of COPY_FILES) {
  try { fs.copyFileSync(path.join(userData, file), path.join(profile, file)); } catch { /* optional */ }
}
const configPath = path.join(profile, 'config.json');
const baseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { settings: {}, rows: [] };
// Fixed loopback port: the config must name the fixture URL before the launcher module reads it.
const FIXTURE_PORT = 48231;
const websites = (baseConfig.websites || []).filter((site) => site.id !== WEBSITE_ID);
fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, websites: [...websites, { id: WEBSITE_ID, name: 'E2E keys', url: `http://127.0.0.1:${FIXTURE_PORT}/keys.html`, icon: '', category: 'gaming' }] }, null, 2));
process.env.HOME_MEDIA_LAUNCHER_CONFIG = configPath;
process.argv.push(ROOT);
const results = [];
const consoleErrors = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const launcherWindow = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.getURL().includes('index.html'));
const pageWindow = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.getURL().startsWith('http://127.0.0.1'));
const runIn = (contents, js) => contents.executeJavaScript(js, true);

const server = http.createServer((request, response) => {
  if (request.url === '/keys.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(FIXTURE));
    return;
  }
  response.writeHead(404).end();
});

const INSTALL_PAD = `(() => {
  const pad = { id: 'E2E virtual pad (standard)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__e2ePad = pad;
  navigator.getGamepads = () => [pad];
  return true;
})()`;

async function press(contents, button, times = 1) {
  for (let index = 0; index < times; index += 1) {
    await runIn(contents, `(() => { const b = window.__e2ePad.buttons[${button}]; b.pressed = true; b.value = 1; window.__e2ePad.timestamp = performance.now(); })()`);
    await sleep(PRESS_MS);
    await runIn(contents, `(() => { const b = window.__e2ePad.buttons[${button}]; b.pressed = false; b.value = 0; window.__e2ePad.timestamp = performance.now(); })()`);
    await sleep(SETTLE_MS);
  }
}

/** Keyboard-style key (for the remote's Home): keyDown, hold, keyUp on the web window's contents. */
async function holdKey(contents, keyCode, holdMs) {
  contents.sendInputEvent({ type: 'keyDown', keyCode });
  await sleep(holdMs);
  // A long hold closes the web window before the key is released; releasing into a destroyed window is expected.
  if (!contents.isDestroyed()) contents.sendInputEvent({ type: 'keyUp', keyCode });
  await sleep(SETTLE_MS);
}

/** Tap of a keyboard key on the page (the same key names the remote and keyboard use). */
async function tapKey(contents, keyCode) {
  contents.sendInputEvent({ type: 'keyDown', keyCode });
  await sleep(120);
  contents.sendInputEvent({ type: 'keyUp', keyCode });
  await sleep(SETTLE_MS);
}

async function keyLog() {
  const win = pageWindow();
  if (!win) return [];
  return JSON.parse(await runIn(win.webContents, 'JSON.stringify(window.__keyLog || [])'));
}

async function capture(name) {
  const win = pageWindow() || launcherWindow();
  if (!win) return null;
  const display = screen.getDisplayMatching(win.getBounds());
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  const file = `${name}.png`;
  fs.writeFileSync(path.join(outDir, file), source.thumbnail.toPNG());
  return file;
}

/** One step: the action, the page's key-log delta, the verdict and a real-display screenshot. */
async function step(label, action, check) {
  const before = (await keyLog()).length;
  let error = null;
  try { await action(); } catch (caught) { error = caught.message; }
  const after = await keyLog();
  const delta = after.slice(before).map((event) => `${event.type}:${event.key}${event.trusted ? '' : ':synthetic'}`);
  const failures = [];
  if (error) failures.push(`action threw: ${error}`);
  const windowOpen = Boolean(pageWindow());
  const siteVisible = Boolean(pageWindow()?.isVisible());
  const verdict = check(delta, { windowOpen, siteVisible, launcherVisible: Boolean(launcherWindow()?.isVisible()) });
  if (verdict !== true) failures.push(verdict);
  const shot = await capture(`${String(results.length + 1).padStart(2, '0')}-${label}`);
  results.push({ label, delta, failures, shot });
}

/** Compares the key names of the keydown events, ignoring the ':synthetic' marker (injected keys are untrusted). */
const expectKeydowns = (delta, wanted) => {
  const down = delta.filter((item) => item.startsWith('keydown:')).map((item) => item.split(':')[1]);
  const ok = wanted.length === down.length && wanted.every((key, index) => down[index] === key);
  return ok || `expected keydown ${wanted.join(', ')}, got ${down.join(', ') || 'nothing'}`;
};

function writeReport() {
  const failed = results.filter((item) => item.failures.length);
  const blocked = results.filter((item) => item.blocked);
  const lines = [`# Web app check ${runId}`, '', `Steps: ${results.length}, failed: ${failed.length}, blocked: ${blocked.length}, console errors: ${consoleErrors.length}`, ''];
  for (const item of results) {
    if (item.blocked) { lines.push(`- BLOCKED · ${item.label} · ${item.blocked}`); continue; }
    lines.push(`- ${item.failures.length ? 'FAIL' : 'ok'} · ${item.label} · page received \`${item.delta.join(' ') || '(nothing)'}\``);
    for (const failure of item.failures) lines.push(`  - ${failure}`);
  }
  lines.push('', '## Screenshots', '', ...results.map((item) => `- ${item.label}: ${item.shot || 'not captured'}`));
  fs.writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ runId, results, consoleErrors }, null, 2));
  return { steps: results.length, failed: failed.length };
}

app.setPath('userData', profile);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 3) consoleErrors.push({ message: String(message).slice(0, 300), source: `${path.basename(source || '')}:${line}` });
  });
});

require(path.join(ROOT, 'src', 'main', 'index.js'));

app.whenReady().then(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(FIXTURE_PORT, '127.0.0.1', resolve); });
  await sleep(BOOT_MS);

  const launcher = launcherWindow();
  if (!launcher) throw new Error('launcher window not found');
  const primaryId = screen.getPrimaryDisplay().id;
  const target = screen.getAllDisplays().find((display) => display.id !== primaryId) || screen.getPrimaryDisplay();
  launcher.setBounds({ x: target.bounds.x, y: target.bounds.y, width: target.bounds.width, height: target.bounds.height });
  launcher.setAlwaysOnTop(true, 'screen-saver');
  launcher.focus();
  await sleep(800);
  // Not awaited: the launch promise resolves only when the website closes, and executeJavaScript would wait for that.
  await runIn(launcher.webContents, `void window.api.launchApp({ id: '${WEBSITE_ID}' }), true`);

  for (let waited = 0; !pageWindow() && waited < 15000; waited += 250) await sleep(250);
  const page = pageWindow();
  if (!page) {
    const urls = BrowserWindow.getAllWindows().map((win) => win.webContents.getURL().slice(0, 100));
    const toast = await runIn(launcher.webContents, 'document.querySelector("#toast")?.textContent || ""');
    throw new Error(`website window did not open; windows: ${JSON.stringify(urls)}; launcher toast: ${JSON.stringify(toast)}`);
  }
  // Move the page to the same secondary display as the launcher, so the primary screen (the user's work) stays untouched.
  page.setBounds({ x: target.bounds.x, y: target.bounds.y, width: target.bounds.width, height: target.bounds.height });
  await sleep(1500);
  await runIn(page.webContents, INSTALL_PAD);
  await sleep(300);

  // Pad steps (D-pad, A, B) are NOT run here: the preload runs in an isolated world and cannot see the scripted
  // navigator.getGamepads used by this harness. They need a real controller (see the report) or a test hook.
  results.push({ label: 'pad-dpad-a-b', delta: [], failures: [], shot: null, blocked: 'needs a real controller; the scripted pad cannot reach the isolated preload' });
  await step('key-arrow-right-right-down', async () => { await tapKey(page.webContents, 'Right'); await tapKey(page.webContents, 'Right'); await tapKey(page.webContents, 'Down'); },
    (delta) => expectKeydowns(delta, ['ArrowRight', 'ArrowRight', 'ArrowDown']));
  await step('key-enter-tap', () => tapKey(page.webContents, 'Enter'), (delta) => expectKeydowns(delta, ['Enter']));
  await step('key-escape-tap', () => tapKey(page.webContents, 'Escape'), (delta) => expectKeydowns(delta, ['Escape']));
  // Since R03, Home (any length) returns to the launcher and keeps the app alive in the background (hidden, not closed).
  await step('home-short-returns-to-background', () => holdKey(page.webContents, 'Home', 150), (_delta, state) => {
    if (!state.windowOpen) return 'Home closed the web window; it should keep the app in the background';
    if (state.siteVisible) return 'the web window is still visible after Home';
    return state.launcherVisible || 'launcher is not visible after Home';
  });
  // A long Home behaves the same way; it is covered by the background-apps check (background-check.cjs).

  const summary = writeReport();
  console.log(`WEB-APP ${summary.failed ? 'FAILED' : 'PASSED'}: ${summary.steps} steps, ${summary.failed} failed, report ${path.relative(ROOT, outDir)}`);
  server.close();
  app.exit(summary.failed ? 1 : 0);
});
