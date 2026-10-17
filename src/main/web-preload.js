'use strict';

const { ipcRenderer } = require('electron');

// Floating exit overlay injected into every fullscreen web app.
// Sandboxed preloads cannot require local modules, so this file is intentionally self-contained.

const INTRO_VISIBLE_MS = 4000;
const AUTO_HIDE_MS = 2800;
const HOLD_TO_EXIT_MS = 700;
const CORNER_ZONE_PX = 140;
const BUTTON = { B: 1, SELECT: 8, START: 9 };

// Applied through adoptedStyleSheets (CSSOM) so strict page CSPs cannot block inline <style>.
const OVERLAY_CSS = `
  :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; margin: 0; padding: 0; border: 0; background: none; overflow: visible; }
  .exit { position: absolute; top: max(20px, 2.2vh); right: max(20px, 2.2vw); display: flex; align-items: center; gap: 12px; padding: 9px 20px 9px 10px; border: 1px solid rgba(255,255,255,.28); border-radius: 999px; background: rgba(12,15,22,.9); color: #fff; font: 600 18px/1 system-ui, sans-serif; cursor: pointer; opacity: 0; transform: translateY(-14px) scale(.96); transition: opacity 220ms ease, transform 220ms ease; pointer-events: none; box-shadow: 0 10px 34px rgba(0,0,0,.5); }
  :host([data-visible]) .exit { opacity: 1; transform: none; pointer-events: auto; }
  .exit:hover, .exit:focus-visible { background: rgba(40,48,66,.96); border-color: #fff; outline: none; }
  .icon { position: relative; display: grid; place-items: center; width: 32px; height: 32px; font-size: 24px; line-height: 1; }
  .icon::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(#fff calc(var(--progress, 0) * 1%), rgba(255,255,255,.25) 0); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0); mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0); }
  .hint { font-weight: 500; font-size: 14px; color: rgba(255,255,255,.62); }
  @media (prefers-reduced-motion: reduce) { .exit { transition-duration: 1ms; } }
`;

function requestClose() {
  ipcRenderer.send('web-app:close');
}

function createOverlay() {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(OVERLAY_CSS);
  root.adoptedStyleSheets = [sheet];

  const button = document.createElement('button');
  button.className = 'exit';
  button.type = 'button';
  button.setAttribute('aria-label', 'Exit to dashboard');
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = '×';
  const label = document.createElement('span');
  label.textContent = 'Exit';
  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'Hold B';
  button.append(icon, label, hint);
  root.append(button);
  button.addEventListener('click', requestClose);

  let hideTimer;
  let engaged = false; // pointer over or keyboard focus on the button: never auto-hide meanwhile

  function hide() {
    if (engaged) return;
    host.removeAttribute('data-visible');
  }

  function show(duration = AUTO_HIDE_MS) {
    host.setAttribute('data-visible', '');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, duration);
  }

  function setProgress(percent) {
    host.style.setProperty('--progress', String(Math.round(percent)));
  }

  button.addEventListener('pointerenter', () => { engaged = true; show(); });
  button.addEventListener('pointerleave', () => { engaged = false; show(1200); });
  button.addEventListener('focus', () => { engaged = true; show(); });
  button.addEventListener('blur', () => { engaged = false; show(1200); });

  // Hot corner: moving the pointer or touching near the top-right corner reveals the button.
  const nearCorner = (event) => event.clientX > window.innerWidth - CORNER_ZONE_PX && event.clientY < CORNER_ZONE_PX;
  window.addEventListener('pointermove', (event) => { if (nearCorner(event)) show(); }, { passive: true, capture: true });
  window.addEventListener('pointerdown', (event) => { if (nearCorner(event)) show(); }, { passive: true, capture: true });

  // Gamepad: hold B for HOLD_TO_EXIT_MS, or press Select + Start together. A single B tap is left to the web app.
  let holdStart = 0;
  let previous = [];
  function pollGamepad(time) {
    const pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean);
    const pressed = (index) => pads.some((pad) => pad.buttons[index]?.pressed);
    if (pressed(BUTTON.SELECT) && pressed(BUTTON.START)) { requestClose(); return; }
    if (pressed(BUTTON.B)) {
      if (!holdStart) holdStart = time;
      const progress = Math.min(1, (time - holdStart) / HOLD_TO_EXIT_MS);
      if (progress > 0.15) { setProgress(progress * 100); show(); }
      if (progress >= 1) { requestClose(); return; }
    } else if (holdStart) {
      holdStart = 0;
      setProgress(0);
    }
    // Start/Select alone reveals the button (and its hint) without closing anything.
    const reveal = (index) => pressed(index) && !previous[index];
    if (reveal(BUTTON.START) || reveal(BUTTON.SELECT)) show();
    previous = [];
    previous[BUTTON.START] = pressed(BUTTON.START);
    previous[BUTTON.SELECT] = pressed(BUTTON.SELECT);
    requestAnimationFrame(pollGamepad);
  }

  return {
    host,
    start() {
      show(INTRO_VISIBLE_MS);
      requestAnimationFrame(pollGamepad);
    }
  };
}

// Native fullscreen elements (e.g. a <video>) sit in the top layer; re-promoting the popover keeps the overlay above them.
function promote(host) {
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch { /* Popover API unavailable: overlay still works outside native fullscreen */ }
}

window.addEventListener('DOMContentLoaded', () => {
  const overlay = createOverlay();
  const { host } = overlay;
  host.setAttribute('popover', 'manual');
  const attach = () => {
    if (!host.isConnected) document.documentElement.append(host);
    promote(host);
  };
  attach();
  document.addEventListener('fullscreenchange', () => promote(host));
  // Some pages rewrite the document; re-attach if the host gets dropped.
  new MutationObserver(() => { if (!host.isConnected) attach(); }).observe(document.documentElement, { childList: true });
  overlay.start();
});
