'use strict';

const { ipcRenderer } = require('electron');

// Floating exit overlay injected into every fullscreen web app.
// Sandboxed preloads cannot require local modules, so this file is intentionally self-contained.
//
// Exit gestures (all hold-to-close so ordinary taps stay with the web app):
//   Guide/Home button (gamepad button 16), Escape, or B held for HOLD_TO_EXIT_MS, or Select + Start together.
// A glass "Close <name>?" panel with a progress ring appears while a hold is in progress.

const INTRO_VISIBLE_MS = 4000;
const AUTO_HIDE_MS = 2800;
const HOLD_TO_EXIT_MS = 700;
const SHOW_CONFIRM_AFTER_MS = 150;
const COVER_FADE_MS = 380;
const CORNER_ZONE_PX = 140;
const BUTTON = { B: 1, SELECT: 8, START: 9, GUIDE: 16 };

function readAppName() {
  const argument = process.argv.find((value) => value.startsWith('--hml-app-name='));
  if (!argument) return 'this app';
  try { return decodeURIComponent(argument.slice('--hml-app-name='.length)) || 'this app'; } catch { return 'this app'; }
}

// Applied through adoptedStyleSheets (CSSOM) so strict page CSPs cannot block inline <style>.
const OVERLAY_CSS = `
  :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; margin: 0; padding: 0; border: 0; background: none; overflow: visible; }
  .cover { position: absolute; inset: 0; background: #000; opacity: 1; animation: cover-out ${COVER_FADE_MS}ms cubic-bezier(.4, 0, .2, 1) 60ms forwards; }
  @keyframes cover-out { to { opacity: 0; } }
  .exit { position: absolute; top: max(20px, 2.2vh); right: max(20px, 2.2vw); display: flex; align-items: center; gap: 12px; padding: 9px 20px 9px 10px; border: 1px solid rgba(255,255,255,.28); border-radius: 999px; background: rgba(12,15,22,.9); color: #fff; font: 600 18px/1 system-ui, sans-serif; cursor: pointer; opacity: 0; transform: translateY(-14px) scale(.96); transition: opacity 220ms ease, transform 220ms ease; pointer-events: none; box-shadow: 0 10px 34px rgba(0,0,0,.5); }
  :host([data-visible]) .exit { opacity: 1; transform: none; pointer-events: auto; }
  .exit:hover, .exit:focus-visible { background: rgba(40,48,66,.96); border-color: #fff; outline: none; }
  .icon { position: relative; display: grid; place-items: center; width: 32px; height: 32px; font-size: 24px; line-height: 1; }
  .hint { font-weight: 500; font-size: 14px; color: rgba(255,255,255,.62); }
  .confirm { position: absolute; left: 50%; bottom: max(48px, 9vh); display: flex; align-items: center; gap: 20px; padding: 18px 32px 18px 20px; border: 1px solid rgba(255,255,255,.26); border-radius: 26px; background: rgba(16,20,30,.86); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); color: #fff; box-shadow: 0 18px 60px rgba(0,0,0,.55); opacity: 0; transform: translate(-50%, 16px) scale(.97); transition: opacity 160ms ease, transform 160ms ease; }
  :host([data-confirm]) .confirm { opacity: 1; transform: translate(-50%, 0) scale(1); }
  .confirm .ring { position: relative; display: grid; place-items: center; width: 60px; height: 60px; font: 400 34px/1 system-ui, sans-serif; }
  .copy { display: grid; gap: 5px; max-width: min(46vw, 520px); }
  .copy strong { font: 650 26px/1.15 system-ui, sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .copy small { font: 500 15px/1.2 system-ui, sans-serif; color: rgba(255,255,255,.62); }
  .icon::before, .ring::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(#fff calc(var(--progress, 0) * 1%), rgba(255,255,255,.25) 0); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 0); mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 0); }
  @media (prefers-reduced-motion: reduce) { .exit, .confirm { transition-duration: 1ms; } .cover { animation-duration: 1ms; animation-delay: 0s; } }
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

  // Black cover that fades out once the page is up, so the window appears with a short fade-in instead of a hard cut.
  const cover = document.createElement('div');
  cover.className = 'cover';
  cover.addEventListener('animationend', () => cover.remove(), { once: true });
  root.append(cover);

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
  hint.textContent = 'Hold Guide';
  button.append(icon, label, hint);
  root.append(button);
  button.addEventListener('click', requestClose);

  const confirm = document.createElement('div');
  confirm.className = 'confirm';
  confirm.setAttribute('role', 'status');
  const ring = document.createElement('span');
  ring.className = 'ring';
  ring.textContent = '×';
  const copy = document.createElement('span');
  copy.className = 'copy';
  const title = document.createElement('strong');
  title.textContent = `Close ${readAppName()}?`;
  const subtitle = document.createElement('small');
  subtitle.textContent = 'Keep holding to close';
  copy.append(title, subtitle);
  confirm.append(ring, copy);
  root.append(confirm);

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

  // Hold sources: name -> timestamp (rAF clock) when the hold started. The longest running hold drives the ring.
  const holds = new Map();
  let escapeHeld = false;
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.repeat) escapeHeld = true; }, { capture: true, passive: true });
  window.addEventListener('keyup', (event) => { if (event.key === 'Escape') escapeHeld = false; }, { capture: true, passive: true });
  window.addEventListener('blur', () => { escapeHeld = false; });

  let previous = {};
  let closing = false;
  function pollInputs(time) {
    if (closing) return;
    const pads = Array.from(navigator.getGamepads?.() || []).filter(Boolean);
    const pressed = (index) => pads.some((pad) => pad.buttons[index]?.pressed);
    if (pressed(BUTTON.SELECT) && pressed(BUTTON.START)) { closing = true; requestClose(); return; }

    const active = { guide: pressed(BUTTON.GUIDE), escape: escapeHeld, b: pressed(BUTTON.B) };
    let progress = 0;
    for (const [source, isHeld] of Object.entries(active)) {
      if (!isHeld) { holds.delete(source); continue; }
      if (!holds.has(source)) holds.set(source, time);
      progress = Math.max(progress, Math.min(1, (time - holds.get(source)) / HOLD_TO_EXIT_MS));
    }
    if (progress * HOLD_TO_EXIT_MS >= SHOW_CONFIRM_AFTER_MS) {
      setProgress(progress * 100);
      host.setAttribute('data-confirm', '');
      show();
    } else {
      host.removeAttribute('data-confirm');
      if (progress === 0) setProgress(0);
    }
    if (progress >= 1) { closing = true; requestClose(); return; }

    // Start/Select alone reveals the button (and its hint) without closing anything.
    const reveal = (index) => pressed(index) && !previous[index];
    if (reveal(BUTTON.START) || reveal(BUTTON.SELECT)) show();
    previous = { [BUTTON.START]: pressed(BUTTON.START), [BUTTON.SELECT]: pressed(BUTTON.SELECT) };
    requestAnimationFrame(pollInputs);
  }

  return {
    host,
    start() {
      show(INTRO_VISIBLE_MS);
      requestAnimationFrame(pollInputs);
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
