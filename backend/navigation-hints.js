'use strict';

/** Navigation remains renderer-local. At most one advisory hint is processed per event-loop batch. */
class NavigationHints {
  constructor(consume) { this.consume = consume; this.latest = null; this.scheduled = null; this.closed = false; }

  push(hint) {
    if (this.closed || !hint || typeof hint !== 'object' || Array.isArray(hint)) return false;
    if (Object.keys(hint).some((key) => !['appId', 'slideshowIndex'].includes(key))) return false;
    if (hint.appId !== undefined && hint.appId !== null && (typeof hint.appId !== 'string' || hint.appId.length > 1024)) return false;
    if (hint.slideshowIndex !== undefined && (!Number.isSafeInteger(hint.slideshowIndex) || hint.slideshowIndex < 0)) return false;
    this.latest = { ...this.latest,
      ...(hint.appId !== undefined ? { appId: hint.appId } : {}),
      ...(hint.slideshowIndex !== undefined ? { slideshowIndex: hint.slideshowIndex } : {}) };
    if (!this.scheduled) this.scheduled = setImmediate(() => {
      this.scheduled = null;
      const latest = this.latest;
      this.latest = null;
      if (!this.closed) {
        try { this.consume(latest); } catch { /* Advisory hints may become stale after configuration changes. */ }
      }
    });
    return true;
  }

  close() { this.closed = true; clearImmediate(this.scheduled); this.latest = null; }
}

module.exports = { NavigationHints };
