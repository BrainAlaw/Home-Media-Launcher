'use strict';

/**
 * Appearance page: home-screen options (tile labels, media widget, header layout and effects) and the categories
 * editor. Everything is a plain control (button, checkbox or <input type="text">), so D-pad / keyboard navigation
 * and a future on-screen keyboard drive it like any other settings field. The staged values are written back by
 * collect(); settings.homeHeader is only written here, its validation and runtime behaviour live elsewhere.
 */
window.AppearanceSettings = (function () {
  const $ = (selector) => document.querySelector(selector);
  const Categories = window.Categories;
  /** @type {import('./categories').Category[]} */
  let categories = Categories.defaults();
  let headerLayout = 'split';
  /** Id of the row whose delete button waits for a second press. */
  let pendingDelete = '';
  let pendingTimer = 0;

  function say(message) {
    const node = $('#category-status');
    if (node) node.textContent = message;
  }

  function disarmDelete() {
    clearTimeout(pendingTimer);
    pendingDelete = '';
  }

  function actionButton(className, text, label, disabled, handler) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.textContent = text;
    node.setAttribute('aria-label', label);
    node.disabled = disabled;
    node.addEventListener('click', handler);
    return node;
  }

  /** @param {string} [focusSelector] control to focus after the list is rebuilt (keeps gamepad focus stable) */
  function renderCategories(focusSelector) {
    const list = $('#category-list');
    list.replaceChildren(...categories.map((category, index) => {
      const row = document.createElement('div');
      row.className = 'category-row';
      row.setAttribute('role', 'listitem');
      row.dataset.id = category.id;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = category.label;
      input.maxLength = Categories.MAX_LABEL;
      input.autocomplete = 'off';
      input.setAttribute('aria-label', category.builtin ? 'Category name (built-in)' : 'Category name');
      input.addEventListener('input', () => {
        if (input.value.trim()) categories = Categories.rename(categories, category.id, input.value);
      });
      input.addEventListener('blur', () => {
        const current = categories.find((entry) => entry.id === category.id);
        if (current) input.value = current.label;
      });
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });

      const reorder = (delta) => {
        disarmDelete();
        categories = Categories.move(categories, category.id, delta);
        const at = categories.findIndex((entry) => entry.id === category.id);
        const canRepeat = delta < 0 ? at > 0 : at < categories.length - 1;
        const kept = (delta < 0) === canRepeat ? '.move-up' : '.move-down';
        renderCategories(`[data-id="${category.id}"] ${kept}`);
      };
      const actions = document.createElement('div');
      actions.className = 'category-actions';
      actions.append(
        actionButton('move-up', '↑', `Move ${category.label} up`, index === 0, () => reorder(-1)),
        actionButton('move-down', '↓', `Move ${category.label} down`, index === categories.length - 1, () => reorder(1))
      );
      if (category.builtin) {
        const tag = document.createElement('span');
        tag.className = 'category-tag';
        tag.textContent = 'Built-in';
        actions.append(tag);
      } else {
        const armed = pendingDelete === category.id;
        const del = actionButton('remove', armed ? 'Press again to delete' : 'Delete', `Delete ${category.label}`, false, () => {
          if (pendingDelete !== category.id) {
            disarmDelete();
            pendingDelete = category.id;
            pendingTimer = setTimeout(() => { disarmDelete(); renderCategories(); }, 4000);
            say(`Press Delete again to remove "${category.label}".`);
            renderCategories(`[data-id="${category.id}"] .remove`);
            return;
          }
          disarmDelete();
          categories = Categories.remove(categories, category.id);
          say(`Removed "${category.label}".`);
          renderCategories('#category-name');
        });
        del.classList.toggle('armed', armed);
        actions.append(del);
      }
      row.append(input, actions);
      return row;
    }));
    if (focusSelector) $(focusSelector.startsWith('#') ? focusSelector : `#category-list ${focusSelector}`)?.focus();
  }

  function addCategory() {
    const input = $('#category-name');
    const result = Categories.add(categories, input.value);
    if (!result.ok) { say(result.error); input.focus(); return; }
    disarmDelete();
    categories = result.list;
    input.value = '';
    say(`Added "${categories.at(-1).label}".`);
    renderCategories('#category-name');
  }

  function syncLayout() {
    document.querySelectorAll('#header-layout button').forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.layout === headerLayout)));
  }

  /** @param {Record<string, any>} settings */
  function populate(settings) {
    disarmDelete();
    categories = Categories.normalise(settings.categories);
    const header = settings.homeHeader || {};
    headerLayout = header.layout === 'centred' ? 'centred' : 'split';
    $('#show-tile-labels').checked = settings.showTileLabels !== false;
    $('#media-widget').checked = settings.mediaWidget !== false;
    $('#header-seconds').checked = header.showSeconds === true;
    $('#header-oled').checked = header.oledProtection === true;
    $('#header-fade').checked = header.fadeIn !== false;
    $('#category-name').value = '';
    say('');
    syncLayout();
    renderCategories();
  }

  /** Staged values to merge into config.settings. */
  function collect() {
    return {
      categories: Categories.normalise(categories),
      showTileLabels: $('#show-tile-labels').checked,
      mediaWidget: $('#media-widget').checked,
      homeHeader: {
        layout: headerLayout,
        showSeconds: $('#header-seconds').checked,
        oledProtection: $('#header-oled').checked,
        fadeIn: $('#header-fade').checked
      }
    };
  }

  function init() {
    $('#category-add').addEventListener('click', addCategory);
    $('#category-name').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addCategory(); } });
    document.querySelectorAll('#header-layout button').forEach((node) => node.addEventListener('click', () => { headerLayout = node.dataset.layout; syncLayout(); }));
  }

  return { init, populate, collect };
})();
