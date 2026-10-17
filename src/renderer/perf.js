/**
 * Performance helpers: frame meter (FPS + long frames), auto-lite governor, mode resolution and a
 * spring-to-CSS `linear()` easing generator. Pure logic is DOM-free so it is unit tested under node:test;
 * the DOM glue (overlay, rAF loop) lives in `createRuntime`, which is only used in the renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Perf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODES = ['auto', 'quality', 'lite'];
  const LONG_FRAME_MS = 33.4;
  const IDLE_GAP_MS = 250;

  /** Unknown or missing values fall back to `auto`. */
  function normalizeMode(value) { return MODES.includes(value) ? value : 'auto'; }

  /** True when the lite look (no blur/shadows/sheen) is active for a configured mode and the governor verdict. */
  function resolveLite(mode, autoLite) {
    const normalized = normalizeMode(mode);
    return normalized === 'lite' || (normalized === 'auto' && Boolean(autoLite));
  }

  /** Rolling frame statistics over the most recent `size` frame durations. */
  class FrameMeter {
    constructor({ size = 120, idleGapMs = IDLE_GAP_MS, longFrameMs = LONG_FRAME_MS } = {}) {
      this.size = size; this.idleGapMs = idleGapMs; this.longFrameMs = longFrameMs;
      this.durations = []; this.last = null; this.totalLong = 0; this.totalFrames = 0;
    }

    /** Feed a rAF timestamp (ms). Gaps longer than `idleGapMs` are idle time, not slow frames. */
    tick(now) {
      if (!Number.isFinite(now)) return null;
      const previous = this.last; this.last = now;
      if (previous === null) return null;
      const dt = now - previous;
      if (dt <= 0 || dt > this.idleGapMs) return null;
      this.durations.push(dt); if (this.durations.length > this.size) this.durations.shift();
      this.totalFrames += 1; if (dt > this.longFrameMs) this.totalLong += 1;
      return dt;
    }

    /** Marks a pause so the next tick does not count the gap. */
    pause() { this.last = null; }

    snapshot() {
      const count = this.durations.length;
      if (!count) return { fps: 0, avgMs: 0, worstMs: 0, longFrames: this.totalLong, frames: this.totalFrames };
      const sum = this.durations.reduce((a, b) => a + b, 0);
      return { fps: 1000 * count / sum, avgMs: sum / count, worstMs: Math.max(...this.durations), longFrames: this.totalLong, frames: this.totalFrames };
    }
  }

  /**
   * Decides when to switch to lite: after `windowMs` of accumulated active frame time the average fps is
   * compared with `threshold`. A passing window resets; a failing one latches `lite` for the session.
   */
  function createGovernor({ windowMs = 5000, threshold = 45, minFrames = 30 } = {}) {
    let elapsed = 0; let frames = 0; let lite = false;
    return {
      push(dt) {
        if (lite || !Number.isFinite(dt) || dt <= 0) return lite;
        elapsed += dt; frames += 1;
        if (elapsed >= windowMs) {
          if (frames >= minFrames && 1000 * frames / elapsed < threshold) lite = true;
          elapsed = 0; frames = 0;
        }
        return lite;
      },
      get lite() { return lite; },
      reset() { elapsed = 0; frames = 0; lite = false; }
    };
  }

  /**
   * CSS `linear()` easing approximating an under-damped spring step response (mass 1). The curve may
   * overshoot 1, which gives the spring feel on transform while staying on the compositor.
   */
  function springEasing({ stiffness = 360, damping = 32, points = 36 } = {}) {
    if (![stiffness, damping, points].every(Number.isFinite) || stiffness <= 0 || damping <= 0 || points < 4) throw new Error('Invalid spring parameters');
    const omega = Math.sqrt(stiffness); const zeta = damping / (2 * omega);
    const response = (t) => {
      if (zeta < 1) {
        const wd = omega * Math.sqrt(1 - zeta * zeta);
        return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta * omega / wd) * Math.sin(wd * t));
      }
      return 1 - Math.exp(-omega * t) * (1 + omega * t);
    };
    const duration = Math.min(2, Math.max(0.1, -Math.log(0.001) / (zeta < 1 ? zeta * omega : omega)));
    const stops = [];
    for (let index = 0; index <= points; index += 1) stops.push(index === points ? 1 : Number(response(duration * index / points).toFixed(4)));
    stops[0] = 0;
    return { easing: `linear(${stops.join(', ')})`, durationMs: Math.round(duration * 1000) };
  }

  /** Renderer glue: optional overlay, activity-driven rAF sampling (no frames are forced while idle) and the governor. */
  function createRuntime({ document: doc, getMode, showOverlay = false, onLiteChange = () => {}, requestFrame = (cb) => requestAnimationFrame(cb), now = () => performance.now() }) {
    const meter = new FrameMeter(); const governor = createGovernor();
    let frame = null; let activeUntil = 0; let overlay = null; let lastPaint = 0; let appliedLite = null;

    const apply = () => {
      const lite = resolveLite(getMode(), governor.lite);
      if (lite === appliedLite) return;
      appliedLite = lite; doc.body.classList.toggle('perf-lite', lite); onLiteChange(lite);
    };

    const needsLoop = () => Boolean(overlay) || (normalizeMode(getMode()) === 'auto' && !governor.lite);

    const paint = (time) => {
      if (!overlay || time - lastPaint < 500) return;
      lastPaint = time; const s = meter.snapshot();
      overlay.textContent = `${s.fps.toFixed(0)} fps  avg ${s.avgMs.toFixed(1)} ms  worst ${s.worstMs.toFixed(0)} ms  long ${s.longFrames}/${s.frames}  ${appliedLite ? 'lite' : 'quality'} (${normalizeMode(getMode())})`;
    };

    const loop = (time) => {
      frame = null;
      const dt = meter.tick(time);
      if (dt !== null && normalizeMode(getMode()) === 'auto') { governor.push(dt); apply(); }
      paint(time);
      if (time < activeUntil && needsLoop()) frame = requestFrame(loop);
      else meter.pause();
    };

    /** Call on input or animation start: keeps the sampling loop alive for a short grace period. */
    function activity() {
      activeUntil = now() + 1500;
      if (frame === null && needsLoop()) frame = requestFrame(loop);
    }

    if (showOverlay) {
      overlay = doc.createElement('div'); overlay.id = 'perf-overlay'; overlay.setAttribute('aria-hidden', 'true');
      doc.body.append(overlay);
    }
    apply();
    for (const type of ['keydown', 'focusin', 'pointermove', 'animationstart', 'transitionrun']) doc.addEventListener(type, activity, { capture: true, passive: true });
    return { activity, meter, governor, refresh() { governor.reset(); appliedLite = null; apply(); }, dispose() { if (frame !== null) cancelAnimationFrame(frame); overlay?.remove(); } };
  }

  return { MODES, normalizeMode, resolveLite, FrameMeter, createGovernor, springEasing, createRuntime };
});
