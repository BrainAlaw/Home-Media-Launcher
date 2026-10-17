'use strict';

/**
 * Chromium switches that keep compositing, rasterisation and video decode on the GPU for the 10-foot UI.
 * `HML_GPU_SAFE=1` disables all of them for machines with broken drivers.
 *
 * Windows: the stock out-of-process GPU path was measured at a hard ~27 fps (one frame every 6 vsyncs at 165 Hz) for ANY
 * animated content, even a lone transformed square, on a host with virtual display adapters (Sunshine/Parsec/SudoMaker)
 * next to a real GPU. Running the GPU service inside the browser process (`in-process-gpu`) restores the full display
 * rate with GPU compositing and rasterisation still enabled. `HML_GPU_PROCESS=separate` opts back out.
 * @param {NodeJS.Platform} platform
 * @param {Record<string, string | undefined>} env
 * @returns {{ switches: Array<[string, string?]>, features: string[], disabledFeatures: string[] }}
 */
function buildGpuSwitches(platform, env) {
  if (env.HML_GPU_SAFE === '1') return { switches: [], features: [], disabledFeatures: [] };
  const switches = [['enable-gpu-rasterization'], ['ignore-gpu-blocklist'], ['disable-renderer-backgrounding']];
  const features = ['CanvasOopRasterization'];
  const disabledFeatures = [];
  if (platform === 'win32') {
    if (env.HML_GPU_PROCESS !== 'separate') switches.push(['in-process-gpu']);
    // Window occlusion tracking can park rAF/compositing of a fullscreen window while another surface overlaps it.
    disabledFeatures.push('CalculateNativeWinOcclusion');
  }
  if (platform === 'linux') {
    switches.push(['enable-zero-copy']);
    features.push('VaapiVideoDecoder', 'VaapiIgnoreDriverChecks');
  }
  return { switches, features, disabledFeatures };
}

/** Applies the switches; must run before `app.whenReady()`. */
function applyGpuSwitches(app, platform = process.platform, env = process.env) {
  const { switches, features, disabledFeatures } = buildGpuSwitches(platform, env);
  for (const [name, value] of switches) {
    if (value === undefined) app.commandLine.appendSwitch(name); else app.commandLine.appendSwitch(name, value);
  }
  if (features.length) app.commandLine.appendSwitch('enable-features', features.join(','));
  if (disabledFeatures.length) app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
}

module.exports = { buildGpuSwitches, applyGpuSwitches };
