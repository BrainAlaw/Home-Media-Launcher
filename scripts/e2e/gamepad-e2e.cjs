'use strict';

/**
 * Gamepad end-to-end harness. Runs the real launcher fullscreen with a copy of the user's configuration in a throwaway
 * profile, drives it with a scripted virtual gamepad (standard mapping) and captures the REAL display after each step
 * (desktopCapturer, never capturePage). Writes `scripts/e2e/out/<run>/report.json`, `report.md` and PNGs.
 *
 * Usage (Windows bash): unset ELECTRON_RUN_AS_NODE; npx electron scripts/e2e/gamepad-e2e.cjs [--keep-open]
 * Token files are never copied and nothing from config files is written to the report.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');

// HML_E2E_ROOT points the run at the checkout that holds the real .env (the main repo), defaulting to this worktree.
const ROOT = process.env.HML_E2E_ROOT ? path.resolve(process.env.HML_E2E_ROOT) : path.resolve(__dirname, '..', '..');
const COPY_FILES = ['config.json', 'remote-apps.json', 'themes.json'];
const BUTTON = Object.freeze({ A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 });
const PRESS_MS = 120;
const SETTLE_MS = 420;
const BOOT_MS = 6000;

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(__dirname, 'out', runId);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-e2e-'));
const userData = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'home-media-launcher');
for (const file of COPY_FILES) {
  try { fs.copyFileSync(path.join(userData, file), path.join(profile, file)); } catch { /* optional */ }
}
fs.mkdirSync(outDir, { recursive: true });
// .env is git-ignored, so a worktree does not have it. Without it Spotify, weather and the host stay unconfigured and the
// report would show that state instead of the user's real one. Run from the checkout that holds the real .env.
if (!fs.existsSync(path.join(ROOT, '.env'))) console.log(`E2E warning: no .env in ${ROOT}; configured services will show as unconfigured`);
process.env.HOME_MEDIA_LAUNCHER_CONFIG = path.join(profile, 'config.json');
app.setPath('userData', profile);

const consoleErrors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) consoleErrors.push({ level: level === 3 ? 'error' : 'warning', message: String(message).slice(0, 300), source: `${path.basename(source || '')}:${line}` });
  });
  contents.on('render-process-gone', (_e, details) => consoleErrors.push({ level: 'error', message: `render process gone: ${details.reason}`, source: 'main' }));
});

process.argv.push(ROOT);
require(path.join(ROOT, 'src', 'main', 'index.js'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mainWindow = () => {
  const wins = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  const found = wins.find((win) => win.webContents.getURL().includes('index.html'));
  if (!found) console.log(`E2E debug: no launcher window; open windows: ${JSON.stringify(wins.map((win) => win.webContents.getURL().slice(0, 120)))}`);
  return found;
};
const run = (js) => mainWindow().webContents.executeJavaScript(js, true);

/** Installs a virtual pad: navigator.getGamepads is looked up by GamepadInput on every frame. */
const INSTALL_PAD = `(() => {
  const pad = { id: 'E2E virtual pad (standard)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__e2ePad = pad;
  navigator.getGamepads = () => [pad];
  return true;
})()`;

async function press(button, times = 1) {
  for (let index = 0; index < times; index += 1) {
    await run(`(() => { const b = window.__e2ePad.buttons[${button}]; b.pressed = true; b.value = 1; window.__e2ePad.timestamp = performance.now(); })()`);
    await sleep(PRESS_MS);
    await run(`(() => { const b = window.__e2ePad.buttons[${button}]; b.pressed = false; b.value = 0; window.__e2ePad.timestamp = performance.now(); })()`);
    await sleep(SETTLE_MS);
  }
}

/** Snapshot of what the user would see: view, focused element and open layers. No configuration values. */
const PROBE = `(() => {
  const el = document.activeElement;
  const describe = (node) => !node || node === document.body ? 'body' : [
    node.tagName.toLowerCase(), node.id ? '#' + node.id : '', node.classList.length ? '.' + [...node.classList].slice(0, 3).join('.') : '',
    node.dataset && node.dataset.tileId ? '[tile]' : '', node.getAttribute('aria-label') ? ' "' + node.getAttribute('aria-label').slice(0, 40) + '"' : ''
  ].join('');
  const openDialogs = [...document.querySelectorAll('dialog[open]')].map((d) => d.id || d.className);
  const panel = document.querySelector('#system-panel');
  return {
    view: typeof state === 'object' ? state.view : 'unknown',
    focus: describe(el),
    focusInWidget: Boolean(el && el.closest && el.closest('#media-widget-slot')),
    focusInRows: Boolean(el && el.closest && el.closest('#rows')),
    panelOpen: Boolean(panel && !panel.hidden && panel.getAttribute('aria-hidden') !== 'true'),
    dialogs: openDialogs,
    mediaViewOpen: Boolean(window.MediaView && window.MediaView.isOpen && window.MediaView.isOpen()),
    oskOpen: Boolean(window.OnScreenKeyboard && window.OnScreenKeyboard.isOpen && window.OnScreenKeyboard.isOpen()),
    iconPopupOpen: Boolean(window.IconPopup && window.IconPopup.isOpen && window.IconPopup.isOpen()),
    tiles: document.querySelectorAll('#rows .tile').length
  };
})()`;

async function capture(name) {
  const win = mainWindow();
  const display = screen.getDisplayMatching(win.getBounds());
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  const file = `${name}.png`;
  fs.writeFileSync(path.join(outDir, file), source.thumbnail.toPNG());
  return file;
}

const results = [];
async function step(scenario, label, action, expect) {
  const errorsBefore = consoleErrors.length;
  let error = null;
  try { await action(); } catch (caught) { error = caught.message; }
  const probe = await run(PROBE).catch((caught) => ({ probeError: caught.message }));
  const failures = [];
  if (error) failures.push(`action threw: ${error}`);
  if (expect) for (const [key, wanted] of Object.entries(expect)) {
    const actual = probe[key];
    const ok = typeof wanted === 'function' ? wanted(actual, probe) : actual === wanted;
    if (!ok) failures.push(`${key}: expected ${typeof wanted === 'function' ? 'predicate' : JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
  }
  const newErrors = consoleErrors.slice(errorsBefore).filter((item) => item.level === 'error');
  for (const item of newErrors) failures.push(`console error: ${item.message} (${item.source})`);
  results.push({ scenario, label, probe, failures });
}

async function scenarioHome() {
  await step('home', 'boot', async () => {}, { view: 'home', tiles: (n) => n > 0, focusInRows: true });
  await step('home', 'right x3', () => press(BUTTON.RIGHT, 3), { focusInRows: true });
  await step('home', 'down', () => press(BUTTON.DOWN), { focusInRows: true });
  await step('home', 'up', () => press(BUTTON.UP), { focusInRows: true });
  await step('home', 'left x3', () => press(BUTTON.LEFT, 3), { focusInRows: true });
  return capture('01-home');
}

async function scenarioWidget() {
  await step('widget', 'up from first row', () => press(BUTTON.UP), { focusInWidget: true });
  await step('widget', 'right x2 inside widget', () => press(BUTTON.RIGHT, 2), { focusInWidget: true });
  const shot = await capture('02-widget');
  await step('widget', 'B leaves widget', () => press(BUTTON.B), { focusInWidget: false });
  // From the header, Down first lands on the widget again (by design); a second Down reaches the tile rows.
  await step('widget', 'down x2 back to rows', () => press(BUTTON.DOWN, 2), { focusInRows: true });
  return shot;
}

async function scenarioMusicView() {
  await step('music-view', 'open (event)', async () => { await run(`document.dispatchEvent(new CustomEvent('launcher:open-media-view'))`); await sleep(900); }, { mediaViewOpen: true });
  await step('music-view', 'down, right', async () => { await press(BUTTON.DOWN); await press(BUTTON.RIGHT); }, { mediaViewOpen: true });
  const shot = await capture('03-music-view');
  await step('music-view', 'B closes', async () => { await press(BUTTON.B); await press(BUTTON.B); }, { mediaViewOpen: false });
  return shot;
}

async function scenarioQuickSettings() {
  await step('quick-settings', 'Start opens sheet', () => press(BUTTON.START), { panelOpen: true });
  await step('quick-settings', 'down x3', () => press(BUTTON.DOWN, 3), { panelOpen: true });
  const shot = await capture('04-quick-settings');
  await step('quick-settings', 'B closes sheet', () => press(BUTTON.B), { panelOpen: false });
  return shot;
}

async function scenarioOsk() {
  // Start opens the sheet with Settings focused first; A opens it. Never touch the network card (it starts a speed test).
  await step('osk', 'open settings via Start + A', async () => { await press(BUTTON.START); await press(BUTTON.A); await sleep(600); },
    { dialogs: (list) => list.includes('settings-dialog') });
  await step('osk', 'focus weather location and press A', async () => {
    await run(`(() => { const input = document.querySelector('#weather-location'); input.focus(); return Boolean(input); })()`);
    await press(BUTTON.A);
    await sleep(500);
  }, { oskOpen: true });
  await step('osk', 'type two keys', async () => { await press(BUTTON.A); await press(BUTTON.RIGHT); await press(BUTTON.A); }, { oskOpen: true });
  const shot = await capture('05-osk');
  await step('osk', 'B cancels keyboard', () => press(BUTTON.B), { oskOpen: false, dialogs: (list) => list.includes('settings-dialog') });
  return shot;
}

async function scenarioIconPopup() {
  await step('icon-popup', 'applications page, focus first icon', async () => {
    await run(`(() => { document.querySelector('.settings-nav [data-page="applications"]').click(); return true; })()`);
    await sleep(500);
    await run(`(() => { const thumb = document.querySelector('#settings-dialog .icon-thumb'); if (thumb) thumb.focus(); return Boolean(thumb); })()`);
  }, { dialogs: (list) => list.includes('settings-dialog') });
  await step('icon-popup', 'A opens popup', async () => { await press(BUTTON.A); await sleep(500); }, { iconPopupOpen: true });
  const shot = await capture('06-icon-popup');
  await step('icon-popup', 'B closes popup only', () => press(BUTTON.B), { iconPopupOpen: false, dialogs: (list) => list.includes('settings-dialog') });
  // Closing Settings returns to the quick-settings sheet (the view it was opened from), not straight to home.
  await step('icon-popup', 'B closes settings (first press)', () => press(BUTTON.B), { dialogs: (list) => !list.includes('settings-dialog') });
  // Diagnostic: if the first press was swallowed, a second press must close Settings. Recorded either way.
  await step('icon-popup', 'B closes settings (second press)', () => press(BUTTON.B), { dialogs: (list) => !list.includes('settings-dialog') });
  return shot;
}

function writeReports(shots) {
  const failed = results.filter((item) => item.failures.length);
  const summary = { run: runId, steps: results.length, failedSteps: failed.length, consoleErrors: consoleErrors.filter((e) => e.level === 'error').length };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ summary, shots, results, consoleErrors }, null, 2));
  const lines = [`# Gamepad e2e report ${runId}`, '', `Steps: ${summary.steps}, failed: ${summary.failedSteps}, console errors: ${summary.consoleErrors}`, ''];
  for (const item of results) {
    lines.push(`- ${item.failures.length ? 'FAIL' : 'ok'} · ${item.scenario} · ${item.label} · focus \`${item.probe.focus}\` · view ${item.probe.view}`);
    for (const failure of item.failures) lines.push(`  - ${failure}`);
  }
  lines.push('', '## Screenshots', '', ...Object.entries(shots).map(([name, file]) => `- ${name}: ${file}`));
  fs.writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`);
  return summary;
}

app.whenReady().then(async () => {
  await sleep(BOOT_MS);
  const win = mainWindow();
  if (!win) { console.error('E2E: launcher window not found'); app.exit(2); return; }
  win.setAlwaysOnTop(true, 'screen-saver');
  win.focus();
  await run(INSTALL_PAD);
  await sleep(300);
  const shots = {};
  for (const [name, scenario] of [['home', scenarioHome], ['widget', scenarioWidget], ['music-view', scenarioMusicView], ['quick-settings', scenarioQuickSettings], ['osk', scenarioOsk], ['icon-popup', scenarioIconPopup]]) {
    try { shots[name] = await scenario(); } catch (error) { results.push({ scenario: name, label: 'scenario crashed', probe: {}, failures: [error.message] }); }
  }
  const summary = writeReports(shots);
  console.log(`E2E ${summary.failedSteps ? 'FAILED' : 'PASSED'}: ${summary.steps} steps, ${summary.failedSteps} failed, report ${path.relative(ROOT, outDir)}`);
  if (!process.argv.includes('--keep-open')) app.exit(summary.failedSteps ? 1 : 0);
});
