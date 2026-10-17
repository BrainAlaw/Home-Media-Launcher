'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

async function battery() {
  if (process.platform === 'win32') {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, '../scripts/get-battery.ps1')
    ], { windowsHide: true, timeout: 8000, maxBuffer: 16384 });
    return JSON.parse(stdout);
  }
  if (process.platform === 'linux') {
    const root = '/sys/class/power_supply';
    const supplies = await fs.readdir(root).catch(() => []);
    const batteries = [];
    for (const name of supplies) {
      const directory = path.join(root, name);
      if ((await fs.readFile(path.join(directory, 'type'), 'utf8').catch(() => '')).trim() !== 'Battery') continue;
      const [capacity, status] = await Promise.all([
        fs.readFile(path.join(directory, 'capacity'), 'utf8').catch(() => ''), fs.readFile(path.join(directory, 'status'), 'utf8').catch(() => '')
      ]);
      batteries.push({ percent: capacity.trim() ? Number(capacity) : null, status: status.trim() });
    }
    const valid = batteries.map((entry) => entry.percent).filter((value) => Number.isFinite(value) && value >= 0 && value <= 100);
    return { present: batteries.length > 0, percent: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null,
      onBattery: !batteries.length || batteries.some((entry) => !['Charging', 'Discharging', 'Full', 'Not charging'].includes(entry.status)) ? null : batteries.some((entry) => entry.status === 'Discharging') };
  }
  return { present: null, percent: null, onBattery: null };
}

async function sample() {
  let network = { linkAvailable: null, interfaceCount: 0 };
  let power = { present: null, percent: null, onBattery: null };
  let error = '';
  try {
    const interfaces = Object.values(os.networkInterfaces()).filter((addresses) => addresses?.some((address) => !address.internal));
    network = { linkAvailable: interfaces.length > 0, interfaceCount: interfaces.length };
  } catch { error = 'Network information unavailable'; }
  try { power = await battery(); }
  catch { error = [error, 'Battery information unavailable'].filter(Boolean).join('; '); }
  parentPort.postMessage({ network, battery: power, sampledAt: new Date().toISOString(), error });
}

const intervalMs = Math.max(1000, Number(workerData?.intervalMs) || 10000);
async function loop() {
  try { await sample(); } catch { /* A failed sample must never stop the loop. */ }
  setTimeout(() => void loop(), intervalMs);
}

void loop();
