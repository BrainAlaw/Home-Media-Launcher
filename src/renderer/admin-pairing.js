(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdminPairing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** "123456" -> "123 456" so the digits are easy to read from the couch. */
  function formatCode(code) {
    const digits = String(code ?? '').replace(/\D/g, '');
    return digits.length === 6 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
  }

  /** Seconds left until `expiresAt` (epoch ms), never negative. */
  function secondsLeft(expiresAt, nowMs) {
    const left = Math.ceil((Number(expiresAt) - nowMs) / 1000);
    return Number.isFinite(left) && left > 0 ? left : 0;
  }

  /** `m:ss` countdown text. */
  function countdownText(seconds) {
    const safe = Math.max(0, Math.floor(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
  }

  /** The address the admin panel is reachable at, shown on the card. */
  function panelUrl(address, port) {
    return `http://${address}:${port}`;
  }

  /**
   * DOM layer. `subscribe` is the bridge's subscription function; `show` is called with `{ code, expiresAt, url }`.
   * The card is informational: it takes no focus and closes on B or Escape, or when the pairing ends.
   */
  function createAdminPairing({ document: doc = (typeof document !== 'undefined' ? document : null), now = () => Date.now(), setTimer = (fn, ms) => setInterval(fn, ms), clearTimer = (id) => clearInterval(id) } = {}) {
    let card = null;
    let timer = 0;
    let expiresAt = 0;
    let visible = false;

    function ensure() {
      if (card || !doc) return;
      card = doc.createElement('section');
      card.id = 'admin-pairing';
      card.className = 'admin-pairing';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'Admin panel pairing code');
      card.hidden = true;
      const title = doc.createElement('h2');
      title.className = 'admin-pairing-title';
      title.textContent = 'Admin panel';
      const code = doc.createElement('p');
      code.className = 'admin-pairing-code';
      const url = doc.createElement('p');
      url.className = 'admin-pairing-url';
      const hint = doc.createElement('p');
      hint.className = 'admin-pairing-hint';
      hint.textContent = 'Open the address on a phone or laptop on this network and enter the code.';
      const countdown = doc.createElement('p');
      countdown.className = 'admin-pairing-countdown';
      card.append(title, code, url, hint, countdown);
      doc.body.append(card);
      card._code = code;
      card._url = url;
      card._countdown = countdown;
    }

    function paint() {
      const left = secondsLeft(expiresAt, now());
      card._countdown.textContent = left > 0 ? `Expires in ${countdownText(left)}` : 'Code expired';
      if (left <= 0) hide();
    }

    function onKey(event) {
      if (!visible) return;
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'GoBack' || event.key === 'BrowserBack' || event.key === 'b' || event.key === 'B') {
        event.preventDefault();
        event.stopImmediatePropagation();
        hide();
      }
    }

    /** Shows the card for a pairing code. Replaces a card that is already showing. */
    function show(info) {
      if (!info || typeof info.code !== 'string') return;
      ensure();
      if (!card) return;
      expiresAt = Number(info.expiresAt) || now() + 5 * 60 * 1000;
      card._code.textContent = formatCode(info.code);
      card._url.textContent = info.url || panelUrl(info.address || 'this-computer', info.port || 8787);
      card.hidden = false;
      visible = true;
      doc.addEventListener('keydown', onKey, true);
      clearTimer(timer);
      timer = setTimer(paint, 1000);
      paint();
    }

    /** Hides the card and stops the countdown. Safe to call at any time. */
    function hide() {
      if (!card) return;
      clearTimer(timer);
      timer = 0;
      if (visible) doc.removeEventListener('keydown', onKey, true);
      visible = false;
      card.hidden = true;
    }

    return { show, hide, get visible() { return visible; } };
  }

  const api = { formatCode, secondsLeft, countdownText, panelUrl, createAdminPairing };
  if (typeof window !== 'undefined' && window.launcher && typeof document !== 'undefined') {
    const card = createAdminPairing();
    window.launcher.onAdminPairCode?.((info) => card.show(info));
    window.launcher.onAdminPaired?.(() => card.hide());
    document.getElementById('admin-pair')?.addEventListener('click', () => {
      window.launcher.adminPair?.().catch(() => {});
    });
    api.card = card;
  }
  return api;
});
