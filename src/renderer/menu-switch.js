(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MenuSwitch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Quick-settings switch rows: `<button role="switch" aria-checked>` with a fixed-size trailing `.switch` track.
   * The visual state is driven only by `aria-checked` and `data-state`, so the knob moves with `transform` alone and
   * the row never changes size between states.
   */

  /** Markup for the trailing track; the knob is the only moving part. */
  function createTrack(doc = document) {
    const track = doc.createElement('span');
    track.className = 'switch';
    track.setAttribute('aria-hidden', 'true');
    const knob = doc.createElement('span');
    knob.className = 'switch-knob';
    track.append(knob);
    return track;
  }

  /** Reads the switch value from its ARIA state. */
  function isOn(element) { return element?.getAttribute('aria-checked') === 'true'; }

  /** Sets the value and an optional busy flag (the knob pulses while a change is in flight). */
  function setSwitch(element, on, { busy = false } = {}) {
    if (!element) return;
    element.setAttribute('aria-checked', String(Boolean(on)));
    element.setAttribute('aria-busy', String(Boolean(busy)));
    if (busy) element.dataset.busy = 'true'; else delete element.dataset.busy;
  }

  return { createTrack, isOn, setSwitch };
});
