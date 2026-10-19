'use strict';

/**
 * Admin panel check on the real machine (R04). Starts the launcher in a temp profile with settings.admin enabled on the LAN
 * address, presses the Settings pairing button (IPC), captures the pairing card on the real display, then talks HTTP to the
 * panel: health, wrong code, right code, config read with secrets masked, and a rejected cross-site write.
 * Output: scripts/e2e/out/admin-<run>/report.md and PNG. The real config is never written.
 *
 * Usage: unset ELECTRON_RUN_AS_NODE; HML_E2E_ROOT=<main checkout> npx electron scripts/e2e/admin-check.cjs
 */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');

const ROOT = process.env.HML_E2E_ROOT ? path.resolve(process.env.HML_E2E_ROOT) : path.resolve(__dirname, '..', '..');
const PORT = 8787;
const COPY_FILES = ['config.json', 'remote-apps.json', 'themes.json'];
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(__dirname, 'out', `admin-${runId}`);
fs.mkdirSync(outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hml-admin-e2e-'));
const userData = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'home-media-launcher');
for (const file of COPY_FILES) {
  try { fs.copyFileSync(path.join(userData, file), path.join(profile, file)); } catch { /* optional */ }
}
const configPath = path.join(profile, 'config.json');
const baseConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : { settings: {}, rows: [] };
const isPrivate = (address) => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(address);
const lanAddress = Object.values(os.networkInterfaces()).flat().find((item) => item.family === 'IPv4' && !item.internal && isPrivate(item.address))?.address;
if (!lanAddress) throw new Error('no LAN IPv4 address found');
fs.writeFileSync(configPath, JSON.stringify({ ...baseConfig, settings: { ...(baseConfig.settings || {}), admin: { enabled: true, port: PORT, bindAddress: lanAddress } } }, null, 2));
process.env.HOME_MEDIA_LAUNCHER_CONFIG = configPath;
app.setPath('userData', profile);
process.argv.push(ROOT);
require(path.join(ROOT, 'src', 'main', 'index.js'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const launcherWindow = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.getURL().includes('index.html'));
const results = [];
const check = (label, ok, detail = '') => results.push({ label, ok, detail });

function request(method, route, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: lanAddress, port: PORT, path: route, method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function capture(name) {
  const win = launcherWindow();
  const display = screen.getDisplayMatching(win.getBounds());
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  fs.writeFileSync(path.join(outDir, `${name}.png`), source.thumbnail.toPNG());
  return `${name}.png`;
}

app.whenReady().then(async () => {
  await sleep(7000);
  const launcher = launcherWindow();
  if (!launcher) throw new Error('launcher window not found');
  const primaryId = screen.getPrimaryDisplay().id;
  const target = screen.getAllDisplays().find((display) => display.id !== primaryId) || screen.getPrimaryDisplay();
  launcher.setBounds({ x: target.bounds.x, y: target.bounds.y, width: target.bounds.width, height: target.bounds.height });
  launcher.setAlwaysOnTop(true, 'screen-saver');
  launcher.focus();
  await sleep(800);

  const health = await request('GET', '/api/health');
  check('health answers on the LAN address', health.status === 200, `status ${health.status}`);
  check('security headers present', health.headers['content-security-policy'] && health.headers['x-content-type-options'] === 'nosniff');

  // Pair from the Settings button (IPC), capture the card on the real display, read the code the TV received.
  await launcher.webContents.executeJavaScript(`window.__adminCode = null; window.launcher.onAdminPairCode((info) => { window.__adminCode = info; }); void window.launcher.adminPair(); true`, true);
  await sleep(1500);
  const card = await launcher.webContents.executeJavaScript('JSON.stringify({ visible: !document.getElementById("admin-pairing")?.hidden, code: document.querySelector(".admin-pairing-code")?.textContent, url: document.querySelector(".admin-pairing-url")?.textContent })', true);
  const shown = JSON.parse(card);
  check('pairing card is shown on the TV', shown.visible === true, JSON.stringify(shown));
  const shot = await capture('01-pairing-card');
  const info = await launcher.webContents.executeJavaScript('JSON.stringify(window.__adminCode)', true);
  const code = JSON.parse(info || 'null')?.code;
  check('TV received a 6-digit code', typeof code === 'string' && /^\d{6}$/.test(code));

  const wrong = await request('POST', '/api/pair', { body: { code: '000000' }, headers: { 'x-hml-request': '1', origin: `http://${lanAddress}:${PORT}` } });
  check('wrong code is refused (401)', wrong.status === 401, `status ${wrong.status}`);

  const pairing = await request('POST', '/api/pair', { body: { code }, headers: { 'x-hml-request': '1', origin: `http://${lanAddress}:${PORT}` } });
  const cookie = (pairing.headers['set-cookie'] || [])[0] || '';
  check('right code gives a session cookie', pairing.status === 200 && cookie.includes('HttpOnly'), `status ${pairing.status}`);

  const configRead = await request('GET', '/api/config', { headers: { cookie: cookie.split(';')[0] } });
  const secretsLeak = /"(VP_API|WEATHER_API|STEAMDB_API|SPOTIFY_CLIENT_ID|SPOTIFY_SOLOIST_API)"\s*:\s*"[^"<][^"]{4,}"/.test(configRead.text);
  check('config read works with the session', configRead.status === 200, `status ${configRead.status}`);
  check('no secret value appears in the config read', !secretsLeak);

  const crossSite = await request('PUT', '/api/config', { body: { settings: {} }, headers: { cookie: cookie.split(';')[0], 'x-hml-request': '1', origin: 'http://evil.example' } });
  check('cross-site write is refused (403)', crossSite.status === 403, `status ${crossSite.status}`);

  const failures = results.filter((item) => !item.ok);
  const lines = [`# Admin check ${runId}`, '', `LAN address: ${lanAddress}:${PORT}`, `Steps: ${results.length}, failed: ${failures.length}`, ''];
  for (const item of results) lines.push(`- ${item.ok ? 'ok' : 'FAIL'} · ${item.label}${item.detail ? ` · ${item.detail}` : ''}`);
  lines.push('', `Screenshot: ${shot}`);
  fs.writeFileSync(path.join(outDir, 'report.md'), `${lines.join('\n')}\n`);
  console.log(`ADMIN-CHECK ${failures.length ? 'FAILED' : 'PASSED'}: ${results.length} checks, ${failures.length} failed, report ${path.relative(ROOT, outDir)}`);
  app.exit(failures.length ? 1 : 0);
});
