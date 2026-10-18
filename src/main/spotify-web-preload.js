'use strict';

const { ipcRenderer } = require('electron');

// Gamepad and keyboard navigation for the embedded Spotify web player. Sandboxed preloads cannot require local
// modules, so this file is self-contained. D-pad / arrow keys move a focus ring between visible interactive elements
// (geometric nearest neighbour), A / Enter clicks, B / Escape / Backspace goes back (closing at the first page),
// bumpers scroll, Guide closes. Text fields keep the keyboard to themselves.

const BUTTON = { A: 0, B: 1, START: 9, LB: 4, RB: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, GUIDE: 16 };
const REPEAT_FIRST_MS = 380;
const REPEAT_NEXT_MS = 110;
const STICK_THRESHOLD = 0.55;
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [role="slider"], [tabindex]:not([tabindex="-1"]), [data-testid="card-click-handler"]';
const DIRECTIONS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const STYLE = `
  :focus-visible { outline: 3px solid #1ed760 !important; outline-offset: 2px !important; border-radius: 8px; }
  ::-webkit-scrollbar { display: none; }
  html { scrollbar-width: none; }
`;

const isTextField = (element) => Boolean(element) && (element.isContentEditable || (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) && !/^(button|checkbox|radio|submit|range)$/i.test(element.type || '')));

function visible(element) {
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return false;
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none' || element.disabled || element.getAttribute('aria-hidden') === 'true') return false;
  return true;
}

function candidates() {
  const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
  const scope = dialog || document;
  return [...scope.querySelectorAll(FOCUSABLE)].filter(visible);
}

function center(rect) { return [rect.left + rect.width / 2, rect.top + rect.height / 2]; }

/** Nearest element in `direction`: small distance along the axis, heavily penalised drift across it. */
function pick(origin, direction, list) {
  const [dx, dy] = DIRECTIONS[direction];
  const [ox, oy] = center(origin);
  let best = null;
  let bestScore = Infinity;
  for (const element of list) {
    const rect = element.getBoundingClientRect();
    const [cx, cy] = center(rect);
    const along = (cx - ox) * dx + (cy - oy) * dy;
    if (along <= 4) continue;
    const across = Math.abs((cx - ox) * dy) + Math.abs((cy - oy) * dx);
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = element; }
  }
  return best;
}

function scrollParent(element) {
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
  }
  return document.scrollingElement;
}

function scrollBy(direction, element) {
  const [dx, dy] = DIRECTIONS[direction];
  (scrollParent(element || document.activeElement) || document.scrollingElement)?.scrollBy({ left: dx * innerWidth * 0.5, top: dy * innerHeight * 0.55, behavior: 'smooth' });
}

function move(direction) {
  const active = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const list = candidates();
  if (!list.length) { scrollBy(direction, null); return; }
  if (!active || !list.includes(active)) {
    const first = direction === 'up' ? list[list.length - 1] : list[0];
    first.focus({ preventScroll: true });
    first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  const next = pick(active.getBoundingClientRect(), direction, list.filter((element) => element !== active));
  if (!next) { scrollBy(direction, active); return; }
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function confirm() {
  const active = document.activeElement;
  if (!active || active === document.body) { move('down'); return; }
  if (isTextField(active)) return;
  active.click();
}

function back() {
  const active = document.activeElement;
  if (isTextField(active)) { active.blur(); return; }
  const dialog = document.querySelector('[role="dialog"], [aria-modal="true"]');
  if (dialog) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    return;
  }
  ipcRenderer.send('spotify-web:back');
}

function act(name) {
  if (name === 'confirm') confirm();
  else if (name === 'back') back();
  else if (name === 'close') ipcRenderer.send('spotify-web:close');
  else if (name === 'pageUp') scrollBy('up', document.activeElement);
  else if (name === 'pageDown') scrollBy('down', document.activeElement);
  else move(name);
}

const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm', Escape: 'back', Backspace: 'back', PageUp: 'pageUp', PageDown: 'pageDown' };

function onKey(event) {
  const name = KEYS[event.key];
  if (!name || event.altKey || event.ctrlKey || event.metaKey) return;
  const typing = isTextField(document.activeElement);
  // Typing keeps arrows, Enter, Backspace and paging; only Escape leaves the field.
  if (typing && event.key !== 'Escape') return;
  // Native buttons and links already click on Enter / Space; only the spatial moves and back need handling.
  if (name === 'confirm' && document.activeElement && document.activeElement !== document.body) return;
  event.preventDefault();
  event.stopPropagation();
  act(name);
}

/** Polls the Gamepad API with edge detection and key-style repeat. */
function startGamepad() {
  const held = new Map();
  const press = (key, down, now, name) => {
    const state = held.get(key) || { down: false, next: 0 };
    if (down && !state.down) { act(name); state.next = now + REPEAT_FIRST_MS; }
    else if (down && state.down && now >= state.next && ['up', 'down', 'left', 'right'].includes(name)) { act(name); state.next = now + REPEAT_NEXT_MS; }
    state.down = down;
    held.set(key, state);
  };
  const tick = () => {
    const now = performance.now();
    for (const pad of navigator.getGamepads?.() || []) {
      if (!pad) continue;
      const b = (index) => Boolean(pad.buttons[index]?.pressed);
      const [x = 0, y = 0] = pad.axes;
      press('up', b(BUTTON.UP) || y < -STICK_THRESHOLD, now, 'up');
      press('down', b(BUTTON.DOWN) || y > STICK_THRESHOLD, now, 'down');
      press('left', b(BUTTON.LEFT) || x < -STICK_THRESHOLD, now, 'left');
      press('right', b(BUTTON.RIGHT) || x > STICK_THRESHOLD, now, 'right');
      press('a', b(BUTTON.A), now, 'confirm');
      press('b', b(BUTTON.B), now, 'back');
      press('lb', b(BUTTON.LB), now, 'pageUp');
      press('rb', b(BUTTON.RB), now, 'pageDown');
      press('guide', b(BUTTON.GUIDE) || b(BUTTON.START) && b(8), now, 'close');
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

window.addEventListener('DOMContentLoaded', () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(STYLE);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  startGamepad();
});
window.addEventListener('keydown', onKey, true);
