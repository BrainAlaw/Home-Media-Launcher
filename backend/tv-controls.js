'use strict';

const { loadRemoteKeymap } = require('../src/main/remote-keymap');

/** Select the nearest candidate in a direction, weighting cross-axis drift more heavily than distance. */
function nearestFocusable(origin, candidates, direction) {
  const vectors = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const vector = vectors[direction];
  if (!origin || !vector) return -1;
  const [dx, dy] = vector;
  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;
  let bestIndex = -1;
  let bestScore = Infinity;
  for (let index = 0; index < candidates.length; index += 1) {
    const rect = candidates[index];
    if (!rect) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const along = (cx - ox) * dx + (cy - oy) * dy;
    if (along <= 4) continue;
    const across = Math.abs((cx - ox) * dy) + Math.abs((cy - oy) * dx);
    const score = along + across * 2.5;
    if (score < bestScore) { bestIndex = index; bestScore = score; }
  }
  return bestIndex;
}

function buildTvControlScript(keymap) {
  const keymapJson = JSON.stringify(keymap);
  return `(() => {
  if (window !== window.top || window.__hmlTvControls) return;
  window.__hmlTvControls = true;
  const nearestFocusable = (${nearestFocusable.toString()});
  const SELECTOR = 'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[role="checkbox"],[role="switch"],[role="slider"],[tabindex]:not([tabindex="-1"]),[data-hml-tv-focus]';
  const DIRECTIONS = ['up', 'down', 'left', 'right'];
  const BUTTON = { A: 0, B: 1, GUIDE: 16, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const KEYMAP = __HML_KEYMAP_JSON__;
  const HOLD_MS = KEYMAP.longPressMs;
  const REPEAT_MS = 260;
  let focused = null;
  let visibleUntil = 0;
  let closeStarted = 0;
  let escapeHeldAt = 0;
  let backHeldAt = 0;
  let previousButtons = new Map();
  const activeHolds = new Map();

  const host = document.createElement('div');
  host.setAttribute('data-hml-tv-overlay', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(':host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color:white;font:600 18px/1.2 system-ui,sans-serif}.bar{position:absolute;top:max(20px,2.2vh);right:max(24px,2.2vw);display:flex;align-items:center;gap:16px;padding:12px 18px;border:1px solid rgba(255,255,255,.24);border-radius:18px;background:rgba(16,25,42,.94);box-shadow:0 12px 36px rgba(0,0,0,.42);opacity:0;transform:translateY(-10px);transition:opacity 180ms ease,transform 180ms ease;pointer-events:none}.bar button{border:0;border-radius:12px;padding:14px 22px;background:#1ed760;color:#101b14;font:700 17px/1 system-ui,sans-serif;cursor:pointer}.bar small{color:rgba(255,255,255,.7);font-size:13px}.confirm{position:absolute;left:50%;bottom:9vh;transform:translate(-50%,12px);padding:18px 26px;border:1px solid rgba(255,255,255,.24);border-radius:18px;background:rgba(16,25,42,.96);box-shadow:0 16px 50px rgba(0,0,0,.5);opacity:0;transition:opacity 120ms ease,transform 120ms ease}.confirm b{font-size:23px}.confirm i{display:block;width:0;height:4px;margin-top:12px;border-radius:4px;background:#1ed760}.on .bar{opacity:1;transform:none;pointer-events:auto}.on .confirm{opacity:1;transform:translate(-50%,0)}@media(prefers-reduced-motion:reduce){.bar,.confirm{transition-duration:1ms}}');
  shadow.adoptedStyleSheets = [sheet];
  const bar = document.createElement('div'); bar.className = 'bar';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Return to launcher'; close.setAttribute('aria-label', 'Return to Home Media Launcher');
  const hint = document.createElement('small'); hint.textContent = 'Hold Guide or Back to close';
  bar.append(close, hint);
  const confirm = document.createElement('div'); confirm.className = 'confirm';
  const confirmText = document.createElement('b'); confirmText.textContent = 'Returning to launcher';
  const progress = document.createElement('i'); confirm.append(confirmText, progress);
  shadow.append(bar, confirm);
  close.addEventListener('click', () => requestClose('button'));

  function attach() { if (!document.documentElement) { document.addEventListener('readystatechange', attach, { once: true }); return; } if (!host.isConnected) document.documentElement.append(host); }
  function reveal(duration = 2600) { attach(); host.classList.add('on'); visibleUntil = performance.now() + duration; }
  function requestClose(reason) { try { window.hmlClose(reason); } catch {} }
  function isTextEntry(element) { return Boolean(element && (element.isContentEditable || element.matches('input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]),textarea,select'))); }
  function candidates() {
    return [...document.querySelectorAll(SELECTOR)].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width >= 8 && rect.height >= 8 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
        && style.display !== 'none' && style.visibility !== 'hidden' && !element.disabled && element.getAttribute('aria-hidden') !== 'true'
        && !element.closest('[inert],[aria-hidden="true"]') && !element.closest('[data-hml-tv-overlay]');
    });
  }
  function focus(element) {
    if (!element) return;
    if (!element.hasAttribute('tabindex') && !element.matches('a[href],button,input,select,textarea,summary')) element.setAttribute('tabindex', '-1');
    try { element.focus({ preventScroll: true }); } catch { element.focus(); }
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focused && focused !== element) focused.removeAttribute('data-hml-tv-focus');
    focused = element;
    focused.setAttribute('data-hml-tv-focus', '');
  }
  function chooseInitial(list) {
    const cx = innerWidth / 2; const cy = innerHeight / 2;
    return list.reduce((best, element) => {
      const rect = element.getBoundingClientRect();
      const distance = Math.hypot(rect.left + rect.width / 2 - cx, rect.top + rect.height / 2 - cy);
      return !best || distance < best.distance ? { element, distance } : best;
    }, null)?.element || null;
  }
  function move(direction) {
    if (isTextEntry(document.activeElement) || document.activeElement?.matches('video,audio')) return false;
    const list = candidates();
    if (!list.length) return false;
    const current = focused?.isConnected ? focused : document.activeElement;
    if (!current || current === document.body || current === document.documentElement || !list.includes(current)) {
      focus(chooseInitial(list)); return true;
    }
    const rects = list.map((element) => element.getBoundingClientRect());
    const index = nearestFocusable(current.getBoundingClientRect(), rects, direction);
    if (index < 0) return false;
    focus(list[index]); reveal(1200); return true;
  }
  function select() {
    if (isTextEntry(document.activeElement)) return false;
    if (!focused?.isConnected || !candidates().includes(focused)) focus(chooseInitial(candidates()));
    if (!focused) return false;
    focused.click(); return true;
  }
  function action(name) {
    if (DIRECTIONS.includes(name)) move(name);
    else if (name === 'confirm') select();
    else if (name === 'back') {
      reveal(1600);
      if (history.length > 2) history.back();
    }
  }
  const keyActions = KEYMAP.keys;
  const longKeyActions = KEYMAP.longKeys;
  window.addEventListener('keydown', (event) => {
    const name = keyActions[event.key] || keyActions[event.code];
    const longAction = longKeyActions[event.key] || longKeyActions[event.code];
    if (!name) return;
    if (name === 'home') {
      if (event.repeat) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try { window.hmlHome(); } catch {}
      return;
    }
    if (name === 'back' && longAction === 'close') { event.preventDefault(); event.stopImmediatePropagation(); window.__hmlTvBackHeld = true; if (!backHeldAt) { backHeldAt = performance.now(); reveal(HOLD_MS + 200); } return; }
    if (isTextEntry(event.target)) return;
    if (name === 'confirm' && focused && event.target !== document.body && event.target !== document.documentElement) return;
    if (action(name)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('pointermove', (event) => { if (event.clientX > innerWidth - 180 && event.clientY < 100) reveal(); }, { passive: true, capture: true });
  window.addEventListener('pointerdown', (event) => { if (event.clientX > innerWidth - 180 && event.clientY < 100) reveal(); }, { passive: true, capture: true });
  const focusSheet = new CSSStyleSheet();
  focusSheet.replaceSync('[data-hml-tv-focus]{outline:4px solid #1ed760!important;outline-offset:4px!important;box-shadow:0 0 0 7px rgba(30,215,96,.24)!important;border-radius:8px!important}');
  try { document.adoptedStyleSheets = [...document.adoptedStyleSheets, focusSheet]; } catch {}
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') activeHolds.clear(); });
  reveal(3200);
  function poll(time) {
    if (!host.isConnected && time < visibleUntil) attach();
    if (time >= visibleUntil && !closeStarted) host.classList.remove('on');
    const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
    const names = [[BUTTON.UP,'up'],[BUTTON.DOWN,'down'],[BUTTON.LEFT,'left'],[BUTTON.RIGHT,'right']];
    for (const pad of pads) {
      for (const [button, name] of names) {
        if (pad.buttons[button]?.pressed) {
          const held = activeHolds.get(name) || { started: time, last: -Infinity };
          if (time - held.last >= (held.last === -Infinity ? 0 : REPEAT_MS)) { action(name); held.last = time; reveal(900); }
          activeHolds.set(name, held);
        } else activeHolds.delete(name);
      }
      const horizontal = pad.axes?.[0] ?? 0; const vertical = pad.axes?.[1] ?? 0;
      if (Math.abs(horizontal) > .62 || Math.abs(vertical) > .62) {
        const name = Math.abs(horizontal) > Math.abs(vertical) ? (horizontal > 0 ? 'right' : 'left') : (vertical > 0 ? 'down' : 'up');
        const held = activeHolds.get('stick') || { started: time, last: -Infinity, name };
        if (held.name !== name || time - held.last >= (held.last === -Infinity ? 280 : REPEAT_MS)) { action(name); held.last = time; held.name = name; reveal(900); }
        activeHolds.set('stick', held);
      } else activeHolds.delete('stick');
      const pressed = (button) => Boolean(pad.buttons[button]?.pressed);
      const closeHeld = pressed(BUTTON.GUIDE) || pressed(BUTTON.B) || (window.__hmlTvEscapeHeld === true);
      const selectNow = pressed(BUTTON.A);
      const wasSelect = previousButtons.get(pad.index) === true;
      if (selectNow && !wasSelect) {
        if (!focused?.isConnected) focus(chooseInitial(candidates()));
        try { window.hmlTvKey('Enter'); } catch { select(); }
      }
      previousButtons.set(pad.index, selectNow);
      if (closeHeld) {
        if (!closeStarted) { closeStarted = time; reveal(HOLD_MS + 200); attach(); host.classList.add('on'); }
        const amount = Math.min(1, (time - closeStarted) / HOLD_MS);
        progress.style.width = Math.round(amount * 100) + '%';
        if (amount >= .2) confirm.classList.add('visible');
        if (amount >= 1) { requestClose('hold'); return; }
      } else { closeStarted = 0; confirm.classList.remove('visible'); progress.style.width = '0'; }
    }
    if (window.__hmlTvEscapeHeld || window.__hmlTvBackHeld) {
      if (!escapeHeldAt) { escapeHeldAt = time; closeStarted = time; reveal(HOLD_MS + 200); }
      const amount = Math.min(1, (time - escapeHeldAt) / HOLD_MS);
      progress.style.width = Math.round(amount * 100) + '%';
      if (amount >= .2) confirm.classList.add('visible');
      if (amount >= 1) { requestClose('hold'); return; }
    } else { escapeHeldAt = 0; if (!pads.length) { closeStarted = 0; confirm.classList.remove('visible'); progress.style.width = '0'; } }
    requestAnimationFrame(poll);
  }
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { window.__hmlTvEscapeHeld = true; if (!closeStarted) { closeStarted = performance.now(); reveal(HOLD_MS + 200); } } }, true);
  window.addEventListener('keyup', (event) => { if (event.key === 'Escape') window.__hmlTvEscapeHeld = false; }, true);
  window.addEventListener('keyup', (event) => {
    const name = keyActions[event.key] || keyActions[event.code];
    const longAction = longKeyActions[event.key] || longKeyActions[event.code];
    if (name === 'home') { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (name !== 'back' || longAction !== 'close') return;
    if (!backHeldAt) return;
    const heldFor = backHeldAt ? performance.now() - backHeldAt : 0;
    backHeldAt = 0; window.__hmlTvBackHeld = false;
    if (heldFor < HOLD_MS) action('back');
  }, true);
  window.addEventListener('blur', () => { window.__hmlTvEscapeHeld = false; window.__hmlTvBackHeld = false; backHeldAt = 0; closeStarted = 0; confirm.classList.remove('visible'); });
  requestAnimationFrame(poll);
})();`.replace('__HML_KEYMAP_JSON__', keymapJson);
}

const defaultKeymap = loadRemoteKeymap();
const TV_CONTROL_SCRIPT = buildTvControlScript(defaultKeymap);

module.exports = { nearestFocusable, buildTvControlScript, TV_CONTROL_SCRIPT };
