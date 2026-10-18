'use strict';

const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

let launchInFlight = null;

function isRunning(platform, execFileAsync = execFile) {
  const command = platform === 'win32' ? 'tasklist' : 'pgrep';
  const args = platform === 'win32'
    ? ['/FI', 'IMAGENAME eq Spotify.exe', '/FO', 'CSV', '/NH']
    : platform === 'darwin' ? ['-f', 'Spotify.app/Contents/MacOS/Spotify'] : ['-x', 'spotify'];
  return new Promise((resolve) => execFileAsync(command, args, { windowsHide: true }, (error, stdout = '') => {
    resolve(!error && (platform === 'win32' ? /"Spotify\.exe"/i.test(stdout) : Boolean(stdout.trim())));
  }));
}

function launchSpec(platform, env) {
  if (platform === 'win32') {
    const executable = env.APPDATA ? path.join(env.APPDATA, 'Spotify', 'Spotify.exe') : 'Spotify.exe';
    return { executable, args: ['--minimized'] };
  }
  if (platform === 'darwin') return { executable: 'open', args: ['-a', 'Spotify', '--args', '--minimized'] };
  return { executable: 'spotify', args: ['--minimized'] };
}

function startDetached(executable, args, spawnProcess = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(executable, args, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (error) { reject(error); return; }
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** Starts the Spotify desktop client in its minimized mode only when it is not already running. */
function ensureSpotifyDesktop({ platform = process.platform, env = process.env, execFileAsync = execFile, spawnProcess = spawn } = {}) {
  if (launchInFlight) return launchInFlight;
  launchInFlight = (async () => {
    if (await isRunning(platform, execFileAsync)) return { ok: true, alreadyRunning: true };
    const { executable, args } = launchSpec(platform, env);
    await startDetached(executable, args, spawnProcess);
    return { ok: true, alreadyRunning: false };
  })().catch((error) => ({ ok: false, error: error.message })).finally(() => { launchInFlight = null; });
  return launchInFlight;
}

module.exports = { ensureSpotifyDesktop, isRunning, launchSpec };
