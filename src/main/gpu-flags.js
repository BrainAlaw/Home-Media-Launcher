'use strict';

/**
 * Chromium switches that keep compositing, rasterisation and video decode on the GPU for the 10-foot UI.
 * `HML_GPU_SAFE=1` disables all of them for machines with broken drivers.
 *
 * Windows: the stock out-of-process GPU presentation path was measured at ~30 fps (one frame every 6 vsyncs at 165 Hz)
 * in fullscreen on a host with virtual display adapters (Sunshine/Parsec/SudoMaker) next to a real GPU. `in-process-gpu`
 * fixes the frame rate but presents a flat grey window in fullscreen (verified with desktopCapturer), so it is opt-in
 * only (`HML_GPU_PROCESS=inprocess`). The default is software compositing (`disable-gpu-compositing`): ~110 fps, correct
 * output, GPU rasterisation kept. `HML_GPU_COMPOSITING=gpu` restores Chromium's default GPU compositing.
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
    if (env.HML_GPU_PROCESS === 'inprocess') switches.push(['in-process-gpu']);
    else if (env.HML_GPU_COMPOSITING !== 'gpu') switches.push(['disable-gpu-compositing']);
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
