'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function linuxDesktopPath() {
  return path.join(os.homedir(), '.config', 'autostart', 'home-media-launcher.desktop');
}

function quoteDesktopArgument(value) {
  return `"${String(value).replace(/%/g, '%%').replace(/([\\"`$])/g, (character) => (character === '\\' ? '\\\\\\\\' : `\\${character}`))}"`;
}

async function getAutostart(app) {
  if (process.platform === 'win32' || process.platform === 'darwin') return app.getLoginItemSettings().openAtLogin;
  try { await fs.access(linuxDesktopPath()); return true; }
  catch { return false; }
}

async function setAutostart(app, enabled) {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
    return getAutostart(app);
  }
  const target = linuxDesktopPath();
  if (!enabled) {
    await fs.rm(target, { force: true });
    return false;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  const args = [process.execPath, ...(app.isPackaged ? [] : [app.getAppPath()])].map(quoteDesktopArgument).join(' ');
  const entry = `[Desktop Entry]\nType=Application\nName=Home Media Launcher\nExec=${args}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
  await fs.writeFile(target, entry, { encoding: 'utf8', mode: 0o600 });
  return true;
}

module.exports = { getAutostart, quoteDesktopArgument, setAutostart };
