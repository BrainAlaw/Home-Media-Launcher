'use strict';

/**
 * Chromium switches that keep compositing, rasterisation and video decode on the GPU for the 10-foot UI.
 * `HML_GPU_SAFE=1` disables all of them for machines with broken drivers.
 * @param {NodeJS.Platform} platform
 * @param {Record<string, string | undefined>} env
 * @returns {{ switches: Array<[string, string?]>, features: string[] }}
 */
function buildGpuSwitches(platform, env) {
  if (env.HML_GPU_SAFE === '1') return { switches: [], features: [] };
  const switches = [['enable-gpu-rasterization'], ['ignore-gpu-blocklist'], ['disable-renderer-backgrounding']];
  const features = ['CanvasOopRasterization'];
  if (platform === 'linux') {
    switches.push(['enable-zero-copy']);
    features.push('VaapiVideoDecoder', 'VaapiIgnoreDriverChecks');
  }
  return { switches, features };
}

/** Applies the switches; must run before `app.whenReady()`. */
function applyGpuSwitches(app, platform = process.platform, env = process.env) {
  const { switches, features } = buildGpuSwitches(platform, env);
  for (const [name, value] of switches) {
    if (value === undefined) app.commandLine.appendSwitch(name); else app.commandLine.appendSwitch(name, value);
  }
  if (features.length) app.commandLine.appendSwitch('enable-features', features.join(','));
}

module.exports = { buildGpuSwitches, applyGpuSwitches };
