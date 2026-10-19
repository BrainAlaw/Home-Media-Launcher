(function (global) {
  const RESULT_HOLD_MS = 20000;
  const FADE_MS = 600;

  function cardView({ speed, finishedAt, now }) {
    if (!speed || speed.state === 'running' || speed.state === 'idle') return 'ip';
    if (speed.state === 'done') {
      if (typeof finishedAt !== 'number') return 'result';
      const elapsed = now - finishedAt;
      if (elapsed < RESULT_HOLD_MS) return 'result';
      if (elapsed < RESULT_HOLD_MS + FADE_MS) return 'fading';
      return 'ip';
    }
    return 'ip';
  }

  function fadeOpacity(view, elapsedMs) {
    if (view === 'fading') {
      const progress = Math.min(Math.max(elapsedMs, 0), FADE_MS) / FADE_MS;
      return 1 - progress;
    }
    if (view === 'result') return 1;
    return 0;
  }

  const api = { cardView, fadeOpacity, RESULT_HOLD_MS, FADE_MS };
  if (typeof window !== 'undefined') window.SpeedCardModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
