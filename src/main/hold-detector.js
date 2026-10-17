'use strict';

/**
 * Pure press-and-hold timing. Feed it `update(held, timeMs)` on a steady tick.
 * `onProgress(0..1)` fires once the hold exceeds `showAfterMs`, `onComplete()` fires once per hold at `holdMs`,
 * and `onCancel()` fires when a hold that was already visible is released early.
 */
function createHoldDetector({ holdMs = 700, showAfterMs = 150, onProgress, onComplete, onCancel } = {}) {
  let start = null;
  let shown = false;
  let completed = false;

  return {
    get holding() { return start !== null; },
    update(held, time) {
      if (!held) {
        const cancelled = shown && !completed;
        start = null; shown = false; completed = false;
        if (cancelled) onCancel?.();
        return;
      }
      if (completed) return;
      if (start === null) start = time;
      const elapsed = time - start;
      const progress = Math.min(1, elapsed / holdMs);
      if (elapsed >= showAfterMs) { shown = true; onProgress?.(progress); }
      if (progress >= 1) { completed = true; onComplete?.(); }
    },
    reset() { start = null; shown = false; completed = false; }
  };
}

module.exports = { createHoldDetector };
