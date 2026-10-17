/**
 * On-screen keyboard (OSK): a bottom-docked sheet driven by d-pad, remote, gamepad or physical keyboard.
 *
 * Public API (window.OnScreenKeyboard):
 *   open({ initial?, placeholder?, type?: 'text'|'search', onChange?(text), onSubmit?(text), onCancel?(initial), onClosed?() })
 *        (onClosed fires once the sheet has left the top layer; restore focus there, not in onSubmit/onCancel)
 *        -> { close(), setText(text), isOpen() }.  Opening while another sheet is open replaces it silently.
 *   isOpen()                    true while the sheet is visible
 *   handleAction(action)        gamepad/app router hook (up/down/left/right/confirm/back/menu); returns true when consumed
 *   attachInput(input, type?)   opens the keyboard for one <input> (live value + input/change events)
 *
 * Declarative opt-in: add `data-osk` (or `data-osk="search"`) to any text/search/url/email input. When it is activated
 * with a gamepad (A -> synthetic click) or a remote (Enter while the last input device is a remote) the keyboard opens
 * and writes back through `input` / `change` events. Real mouse clicks and plain keyboard typing keep native behaviour.
 *
 * Controls: d-pad/arrows move (wrapping), A/Enter types the focused key, X/Backspace deletes, Y types a space,
 * LB toggles shift, Start/Menu submits, B/Esc cancels. Physical typing is forwarded to the field while open.
 * The sheet is a modal <dialog>, so it sits above other modals (Settings) without z-index fights.
 * Only transform and opacity animate.
 */
(function () {
  'use strict';

  const { buildLayout, clampPosition, locate, move, createState, isShifted, press, backspace, insert, isPrintable } = window.KeyboardLayout;

  const CLOSE_FALLBACK_MS = 360;
  const PAD = { A: 0, X: 2, Y: 3, LB: 4 };
  const REPEAT_DELAY_MS = 380;
  const REPEAT_INTERVAL_MS = 70;
  const OSK_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'email']);

  /** @type {ReturnType<typeof createSession> | null} */
  let session = null;

  const el = (tag, className, attrs = {}) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };

  function createSession(options) {
    const type = options.type === 'search' ? 'search' : 'text';
    const initial = String(options.initial ?? '');
    let model = createState(initial);
    let layout = buildLayout({ layer: model.layer, shifted: isShifted(model), type });
    let position = clampPosition(layout, { row: 1, col: 0, anchor: 0 });
    let physicalTyping = false;
    let closing = false;
    let rafHandle = 0;
    const padState = new Map();

    const dialog = el('dialog', 'osk', { 'aria-label': 'On-screen keyboard', tabindex: '-1' });
    const scrim = el('div', 'osk-scrim');
    const sheet = el('div', 'osk-sheet');
    const field = el('div', 'osk-field', { role: 'textbox', 'aria-readonly': 'true', 'aria-live': 'polite', 'aria-label': options.placeholder || (type === 'search' ? 'Search' : 'Text') });
    const textNode = el('span', 'osk-text');
    const caret = el('span', 'osk-caret', { 'aria-hidden': 'true' });
    const placeholder = el('span', 'osk-placeholder', { 'aria-hidden': 'true' });
    placeholder.textContent = options.placeholder || '';
    field.append(placeholder, textNode, caret);
    const keysRoot = el('div', 'osk-keys', { role: 'group', 'aria-label': 'Keys' });
    const hints = el('div', 'osk-hints', { 'aria-hidden': 'true' });
    hints.innerHTML = [
      '<span class="pad"><b>A</b> Type</span><span class="pad"><b>X</b> Delete</span><span class="pad"><b>Y</b> Space</span><span class="pad"><b>LB</b> Shift</span><span class="pad"><b>B</b> Cancel</span><span class="pad"><b>Menu</b> Done</span>',
      '<span class="kbd"><b>Enter</b> Type</span><span class="kbd"><b>Backspace</b> Delete</span><span class="kbd"><b>Esc</b> Cancel</span><span class="kbd"><b>F1</b> Done</span>'
    ].join('');
    sheet.append(field, keysRoot, hints);
    dialog.append(scrim, sheet);

    /** @type {HTMLElement[][]} */
    let keyElements = [];

    function renderKeys() {
      keysRoot.replaceChildren();
      keyElements = layout.rows.map((row, r) => {
        const rowElement = el('div', 'osk-row', { role: 'group' });
        const buttons = row.keys.map((key, c) => {
          const button = el('button', `osk-key osk-${key.kind}`, { type: 'button', tabindex: '-1', 'aria-label': key.ariaLabel || key.label });
          button.textContent = key.label;
          button.dataset.kind = key.kind;
          button.style.gridColumn = `${Math.round(key.x * 2) + 1} / span ${Math.round(key.width * 2)}`;
          if (key.kind === 'shift') {
            button.setAttribute('aria-pressed', String(model.shift !== 'off'));
            button.dataset.shift = model.shift;
          }
          button.addEventListener('mousedown', (event) => event.preventDefault());
          button.addEventListener('click', () => { position = { row: r, col: c, anchor: key.x + key.width / 2 }; paintFocus(); activate(key, button); });
          rowElement.append(button);
          return button;
        });
        keysRoot.append(rowElement);
        return buttons;
      });
      paintFocus();
    }

    function paintFocus() {
      keyElements.forEach((row, r) => row.forEach((button, c) => {
        const focused = r === position.row && c === position.col;
        button.classList.toggle('focused', focused);
        if (focused) dialog.setAttribute('aria-activedescendant', button.id || (button.id = `osk-key-${r}-${c}`));
      }));
    }

    function renderText() {
      textNode.textContent = model.text;
      field.dataset.empty = String(model.text.length === 0);
      field.setAttribute('aria-valuetext', model.text);
    }

    /** Rebuilds the layout from the model, keeping the cursor on the same key when it still exists. */
    function syncLayout() {
      const focusedId = layout.rows[position.row]?.keys[position.col]?.id;
      layout = buildLayout({ layer: model.layer, shifted: isShifted(model), type });
      position = locate(layout, focusedId, position);
      renderKeys();
    }

    function commit(next, { structural = false } = {}) {
      const textChanged = next.text !== model.text;
      const layoutChanged = structural || next.layer !== model.layer || next.shift !== model.shift;
      model = next;
      if (textChanged) { renderText(); options.onChange?.(model.text); }
      if (layoutChanged) syncLayout();
    }

    function flash(button) {
      button.classList.remove('pressed');
      void button.offsetWidth; // restart the one-shot press animation
      button.classList.add('pressed');
    }

    function activate(key, button) {
      if (button) flash(button);
      const result = press(model, key);
      commit(result.state);
      if (result.submit) submit();
    }

    function pressFocused() {
      const key = layout.rows[position.row].keys[position.col];
      activate(key, keyElements[position.row]?.[position.col]);
    }

    function deleteLast() { commit(backspace(model)); }
    function typeSpace() { commit(insert(model, ' ')); }
    function cycleShift() {
      if (model.layer !== 'letters') return;
      commit(press(model, { kind: 'shift' }).state);
    }

    function submit() { if (closing) return; const text = model.text; teardown(); options.onSubmit?.(text); }
    function cancel() { if (closing) return; teardown(); options.onCancel?.(initial); }

    function handleAction(action) {
      switch (action) {
        case 'up': case 'down': case 'left': case 'right':
          position = move(layout, position, action);
          paintFocus();
          break;
        case 'confirm': pressFocused(); break;
        case 'back': cancel(); break;
        case 'menu': submit(); break;
        default: break;
      }
    }

    /* Navigation keys arrive here directly or as remote-input's synthetic replay (both bubble through the dialog). */
    dialog.addEventListener('keydown', (event) => {
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'confirm', Escape: 'back', ContextMenu: 'menu', F1: 'menu' };
      const action = map[event.key];
      event.stopPropagation();
      if (!action) return;
      event.preventDefault();
      handleAction(action);
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); cancel(); });

    /* Physical keyboard: runs in the capture phase on window so it precedes remote-input's key replay. */
    function onWindowKey(event) {
      if (!event.isTrusted || closing) return;
      if (event.key === 'Backspace') {
        event.preventDefault(); event.stopImmediatePropagation();
        physicalTyping = true;
        deleteLast();
      } else if (event.key === 'Enter' && physicalTyping) {
        event.preventDefault(); event.stopImmediatePropagation();
        submit();
      } else if (isPrintable(event)) {
        event.preventDefault(); event.stopImmediatePropagation();
        physicalTyping = true;
        commit(insert(model, event.key));
      }
    }
    window.addEventListener('keydown', onWindowKey, true);

    /* Gamepad extras the shared router does not carry: X delete (with repeat), Y space, LB shift. */
    function pollPads(time) {
      rafHandle = requestAnimationFrame(pollPads);
      const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
      const down = new Set();
      for (const pad of pads) {
        if (!pad || pad.connected === false) continue;
        for (const [name, index] of Object.entries(PAD)) if (name !== 'A' && pad.buttons[index]?.pressed) down.add(name);
      }
      for (const name of ['X', 'Y', 'LB']) {
        const held = padState.get(name);
        if (!down.has(name)) { padState.delete(name); continue; }
        if (!held) {
          padState.set(name, { next: time + REPEAT_DELAY_MS });
          if (name === 'X') deleteLast(); else if (name === 'Y') typeSpace(); else cycleShift();
        } else if (name === 'X' && time >= held.next) {
          held.next = time + REPEAT_INTERVAL_MS;
          deleteLast();
        }
      }
    }
    function teardown() {
      if (closing) return;
      closing = true;
      cancelAnimationFrame(rafHandle);
      window.removeEventListener('keydown', onWindowKey, true);
      if (session === api) session = null;
      dialog.classList.remove('open');
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        options.onClosed?.();
      };
      sheet.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, CLOSE_FALLBACK_MS);
    }

    const api = {
      handleAction,
      isOpen: () => !closing,
      setText(text) { commit({ ...model, text: String(text) }, { structural: false }); },
      /** Closes without firing callbacks. */
      dispose() { if (!closing) teardown(); },
      close() { cancel(); }
    };

    // Mount inside the topmost modal so nothing is inert; a <dialog> in the top layer works for both cases.
    document.body.append(dialog);
    renderText();
    renderKeys();
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('open')));
    // Buttons already held while opening (e.g. the press that opened the sheet) stay latched until released.
    for (const pad of navigator.getGamepads ? Array.from(navigator.getGamepads()) : []) {
      if (!pad) continue;
      for (const [name, index] of Object.entries(PAD)) if (name !== 'A' && pad.buttons[index]?.pressed) padState.set(name, { next: Infinity });
    }
    rafHandle = requestAnimationFrame(pollPads);
    return api;
  }

  /** @param {{ initial?: string, placeholder?: string, type?: 'text'|'search', onChange?: (text: string) => void, onSubmit?: (text: string) => void, onCancel?: (initial: string) => void }} options */
  function open(options = {}) {
    session?.dispose();
    session = createSession(options);
    const current = session;
    return { close: () => current.close(), setText: (text) => current.setText(text), isOpen: () => current.isOpen() };
  }

  const isOpen = () => session !== null;
  const handleAction = (action) => (session ? (session.handleAction(action), true) : false);

  /** Binds the keyboard to a single input element. */
  function attachInput(input, type) {
    const initial = input.value;
    const fire = (name) => input.dispatchEvent(new Event(name, { bubbles: true }));
    return open({
      initial,
      placeholder: input.placeholder || input.getAttribute('aria-label') || '',
      type: type || (input.type === 'search' || input.dataset.osk === 'search' ? 'search' : 'text'),
      onChange: (text) => { input.value = text; fire('input'); },
      onSubmit: (text) => { input.value = text; fire('input'); fire('change'); },
      onCancel: (original) => { if (input.value !== original) { input.value = original; fire('input'); } },
      onClosed: () => input.focus({ preventScroll: true })
    });
  }

  function oskTarget(event) {
    const input = event.target instanceof Element ? event.target.closest('input[data-osk]') : null;
    return input && !input.disabled && !input.readOnly && OSK_INPUT_TYPES.has(input.type) ? input : null;
  }

  // Gamepad A on a focused control is dispatched as `element.click()`, which is untrusted; real mouse clicks are trusted.
  document.addEventListener('click', (event) => {
    if (event.isTrusted || session) return;
    const input = oskTarget(event);
    if (input) attachInput(input);
  }, true);

  // Remote select arrives as Enter while the last input device is a remote (a keyboard keeps native editing).
  document.addEventListener('keydown', (event) => {
    if (session || event.key !== 'Enter' || document.body.dataset.inputDevice !== 'remote') return;
    const input = oskTarget(event);
    if (!input) return;
    event.preventDefault();
    attachInput(input);
  }, true);

  window.OnScreenKeyboard = { open, isOpen, handleAction, attachInput };
})();
