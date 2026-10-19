'use strict';

(function () {
  const app = document.getElementById('app');
  const logoutButton = document.getElementById('logout-button');
  const pageNav = document.getElementById('page-nav');
  const requestHeaders = { 'X-HML-Request': '1', 'Content-Type': 'application/json' };
  const STATUS_INTERVAL_MS = 5000;
  const STATUS_LABELS = {
    version: 'Launcher', uptime: 'Uptime', admin: 'Admin panel', host: 'Vibepollo host',
    soloist: 'Soloist', network: 'Network', weather: 'Weather'
  };
  const STATUS_STATE_TEXT = { ok: 'OK', unknown: 'Unknown', error: 'Error' };
  const PAGES = [['settings', 'Settings'], ['status', 'Status'], ['log', 'Log']];
  let descriptor = null;
  let originalSettings = null;
  let workingSettings = null;
  let activeGroup = null;
  let activePage = 'settings';
  let statusTimer = null;
  let statusRequest = null;

  async function readJson(response) {
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status}).`);
    return body;
  }

  function inlineDescriptor() {
    const block = document.getElementById('settings-descriptor');
    if (!block || !block.textContent.trim()) return null;
    try {
      const value = JSON.parse(block.textContent);
      return value && value.GROUPS && Array.isArray(value.SETTINGS) ? value : null;
    } catch { return null; }
  }

  async function resolveDescriptor(passedDescriptor) {
    try {
      const response = await fetch('/api/settings-description', { headers: { Accept: 'application/json' } });
      const remote = await readJson(response);
      if (remote && remote.GROUPS && Array.isArray(remote.SETTINGS)) return remote;
    } catch { /* The embedded descriptor keeps static builds usable before route wiring. */ }
    return passedDescriptor || inlineDescriptor();
  }

  function setStatus(container, message, kind = '') {
    container.textContent = message;
    container.className = `status${kind ? ` status-${kind}` : ''}`;
    container.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function showPairForm(message = '') {
    pageNav.hidden = true;
    pageNav.replaceChildren();
    activePage = 'settings';
    syncStatusPolling();
    app.replaceChildren();
    const card = document.createElement('section');
    card.className = 'card auth-card';
    const heading = document.createElement('h2');
    heading.textContent = 'Pair this device';
    const description = document.createElement('p');
    description.textContent = 'Enter the pairing code shown by the launcher.';
    const form = document.createElement('form');
    form.className = 'stack';
    const label = document.createElement('label');
    label.htmlFor = 'pair-code';
    label.textContent = 'Pairing code';
    const input = document.createElement('input');
    input.id = 'pair-code';
    input.name = 'code';
    input.type = 'text';
    input.autocomplete = 'one-time-code';
    input.inputMode = 'numeric';
    input.required = true;
    input.maxLength = 32;
    const error = document.createElement('p');
    error.className = 'form-message';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    const submit = document.createElement('button');
    submit.className = 'button';
    submit.type = 'submit';
    submit.textContent = 'Pair';
    form.append(label, input, error, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      error.textContent = '';
      try {
        await readJson(await fetch('/api/pair', {
          method: 'POST', headers: requestHeaders, body: JSON.stringify({ code: input.value.trim() })
        }));
        await loadAuthenticatedPanel();
      } catch (failure) {
        error.textContent = failure.message;
        submit.disabled = false;
      }
    });
    card.append(heading, description, form);
    app.append(card);
    input.focus();
  }

  function makeField(entry, settings) {
    const wrapper = document.createElement('div');
    wrapper.className = `field${entry.type === 'object' ? ' field-wide' : ''}`;
    const label = document.createElement('label');
    const id = `setting-${entry.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    label.htmlFor = id;
    label.textContent = entry.label;
    const help = document.createElement('p');
    help.className = 'field-help';
    help.textContent = entry.help || '';
    const error = document.createElement('p');
    error.className = 'field-error';
    error.id = `${id}-hint`;
    error.setAttribute('aria-live', 'polite');
    const presentValue = window.AdminPanelFormModel.valueAt(settings, entry.path);
    const value = presentValue === undefined ? entry.default : presentValue;
    let control;

    if (entry.type === 'object') {
      control = document.createElement('pre');
      control.className = 'object-value';
      control.textContent = value === undefined ? 'Not set' : JSON.stringify(value, null, 2);
      control.setAttribute('aria-label', `${entry.label}, read only`);
      const note = document.createElement('p');
      note.className = 'field-help';
      note.textContent = 'Structured settings are read only in this panel. Edit on the TV for now.';
      wrapper.append(label, help, control, note);
      return wrapper;
    }

    if (entry.type === 'boolean') {
      const row = document.createElement('div');
      row.className = 'checkbox-row';
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = Boolean(value);
      row.append(control);
      row.append(document.createTextNode('Enabled'));
      wrapper.append(label, row, help, error);
    } else if (entry.type === 'enum') {
      control = document.createElement('select');
      const options = Array.isArray(entry.options) ? entry.options : [];
      for (const optionValue of options) {
        const option = document.createElement('option');
        option.value = String(optionValue);
        option.textContent = String(optionValue);
        control.append(option);
      }
      if (value !== undefined && !options.includes(value)) {
        const unknown = document.createElement('option');
        unknown.value = String(value);
        unknown.textContent = `Unknown value: ${String(value)}`;
        control.append(unknown);
      }
      control.value = value === undefined ? '' : String(value);
      wrapper.append(label, control, help, error);
    } else {
      control = document.createElement('input');
      control.type = entry.type === 'number' ? 'number' : 'text';
      if (value !== undefined && value !== null) control.value = String(value);
      if (entry.type === 'number') {
        const minimum = entry.minimum ?? entry.min;
        const maximum = entry.maximum ?? entry.max;
        if (minimum !== undefined) control.min = String(minimum);
        if (maximum !== undefined) control.max = String(maximum);
        control.step = 'any';
      }
      wrapper.append(label, control, help, error);
    }

    control.id = id;
    control.setAttribute('aria-describedby', `${help.textContent ? `${id}-help ` : ''}${error.id}`.trim());
    if (help.textContent) help.id = `${id}-help`;
    control.addEventListener('input', () => {
      const nextValue = entry.type === 'boolean' ? control.checked
        : entry.type === 'number' ? (control.value === '' ? '' : Number(control.value)) : control.value;
      const hint = window.AdminPanelFormModel.validateField(entry, nextValue);
      error.textContent = hint.valid ? '' : hint.message;
      error.classList.toggle('visible', !hint.valid);
      workingSettings = window.AdminPanelFormModel.withValue(workingSettings, entry.path, nextValue);
      updateSaveState();
    });
    if (value !== undefined) {
      const hint = window.AdminPanelFormModel.validateField(entry, value);
      error.textContent = hint.valid ? '' : hint.message;
      error.classList.toggle('visible', !hint.valid);
    }
    return wrapper;
  }

  function updateSaveState() {
    const changed = window.AdminPanelFormModel.changedPaths(originalSettings, workingSettings);
    const button = document.getElementById('save-settings');
    if (button) button.disabled = changed.length === 0;
    const count = document.getElementById('change-count');
    if (count) count.textContent = changed.length ? `${changed.length} setting${changed.length === 1 ? '' : 's'} changed.` : 'No unsaved changes.';
  }

  function renderSettings() {
    app.replaceChildren();
    const navigation = document.createElement('nav');
    navigation.className = 'group-nav card';
    navigation.setAttribute('aria-label', 'Settings sections');
    const content = document.createElement('section');
    content.className = 'content-column';
    const layout = document.createElement('div');
    layout.className = 'settings-layout';
    const groups = Object.entries(descriptor.GROUPS || {});
    if (!groups.length) throw new Error('The settings description contains no groups.');

    function selectGroup(groupKey) {
      activeGroup = groupKey;
      for (const button of navigation.querySelectorAll('button')) {
        const selected = button.dataset.group === groupKey;
        button.setAttribute('aria-current', selected ? 'page' : 'false');
      }
      content.replaceChildren();
      const title = document.createElement('h2');
      title.textContent = descriptor.GROUPS[groupKey];
      const form = document.createElement('form');
      form.id = 'settings-form';
      form.className = 'field-grid';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = document.getElementById('form-message');
        const changed = window.AdminPanelFormModel.changedPaths(originalSettings, workingSettings);
        if (!changed.length) return;
        const saveButton = document.getElementById('save-settings');
        saveButton.disabled = true;
        setStatus(message, 'Saving…');
        try {
          await readJson(await fetch('/api/config', {
            method: 'PUT', headers: requestHeaders, body: JSON.stringify({ settings: workingSettings })
          }));
          originalSettings = JSON.parse(JSON.stringify(workingSettings));
          setStatus(message, 'Settings saved.', 'success');
          updateSaveState();
        } catch (failure) {
          setStatus(message, failure.message, 'error');
          updateSaveState();
        }
      });

      const fields = window.AdminPanelFormModel.fieldsFor(descriptor, groupKey);
      if (fields.length) {
        for (const entry of fields) form.append(makeField(entry, workingSettings));
      } else {
        const empty = document.createElement('p');
        empty.className = 'empty-group';
        empty.textContent = groupKey === 'admin'
          ? 'Admin server settings are set in config.json before the panel starts.'
          : 'There are no settings in this section yet.';
        form.append(empty);
      }

      const actions = document.createElement('div');
      actions.className = 'form-actions field-wide';
      const count = document.createElement('p');
      count.id = 'change-count';
      count.className = 'change-count';
      const save = document.createElement('button');
      save.id = 'save-settings';
      save.className = 'button';
      save.type = 'submit';
      save.textContent = 'Save changes';
      save.disabled = true;
      actions.append(count, save);
      form.append(actions);
      const message = document.createElement('p');
      message.id = 'form-message';
      message.className = 'form-message field-wide';
      message.setAttribute('role', 'status');
      form.append(message);
      content.append(title, form);
      updateSaveState();
    }

    for (const [key, name] of groups) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-item';
      button.dataset.group = key;
      button.textContent = name;
      button.addEventListener('click', () => selectGroup(key));
      navigation.append(button);
    }
    layout.append(navigation, content);
    app.append(layout);
    selectGroup(activeGroup && descriptor.GROUPS[activeGroup] ? activeGroup : groups[0][0]);
  }

  function describeDetail(detail) {
    if (detail === undefined || detail === null || detail === '') return '';
    if (typeof detail === 'string') return detail;
    const text = JSON.stringify(detail);
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  }

  function renderStatusGrid(report) {
    const grid = document.createElement('div');
    grid.className = 'status-grid';
    for (const [key, entry] of Object.entries(report)) {
      const state = Object.hasOwn(STATUS_STATE_TEXT, entry.state) ? entry.state : 'unknown';
      const item = document.createElement('section');
      item.className = `status-item status-state-${state}`;
      const label = document.createElement('h3');
      label.className = 'status-item-label';
      label.textContent = STATUS_LABELS[key] || key;
      const value = document.createElement('p');
      value.className = 'status-item-value';
      const detail = describeDetail(entry.detail);
      value.textContent = detail ? `${STATUS_STATE_TEXT[state]}: ${detail}` : STATUS_STATE_TEXT[state];
      item.append(label, value);
      grid.append(item);
    }
    return grid;
  }

  async function refreshStatus() {
    if (statusRequest) return statusRequest;
    const message = document.getElementById('status-message');
    const body = document.getElementById('status-body');
    if (!message || !body) return null;
    statusRequest = (async () => {
      try {
        const report = await readJson(await fetch('/api/status', { headers: { Accept: 'application/json' } }));
        body.replaceChildren(renderStatusGrid(report));
        setStatus(message, `Updated ${new Date().toLocaleTimeString('en-GB')}.`);
      } catch (failure) {
        setStatus(message, failure.message, 'error');
      } finally {
        statusRequest = null;
      }
    })();
    return statusRequest;
  }

  /** Status refreshes every few seconds, only while its page is open and the browser tab is visible. */
  function syncStatusPolling() {
    const shouldPoll = activePage === 'status' && document.visibilityState !== 'hidden';
    if (shouldPoll && statusTimer === null) {
      statusTimer = window.setInterval(() => { void refreshStatus(); }, STATUS_INTERVAL_MS);
      void refreshStatus();
    } else if (!shouldPoll && statusTimer !== null) {
      window.clearInterval(statusTimer);
      statusTimer = null;
    }
  }

  function renderStatusPage() {
    app.replaceChildren();
    const card = document.createElement('section');
    card.className = 'card';
    const heading = document.createElement('h2');
    heading.textContent = 'Status';
    const message = document.createElement('p');
    message.id = 'status-message';
    message.className = 'status';
    message.setAttribute('role', 'status');
    message.textContent = 'Checking…';
    const body = document.createElement('div');
    body.id = 'status-body';
    card.append(heading, message, body);
    app.append(card);
  }

  async function loadLog() {
    const message = document.getElementById('log-message');
    const view = document.getElementById('log-view');
    if (!message || !view) return;
    try {
      const { entries } = await readJson(await fetch('/api/log?tail=200', { headers: { Accept: 'application/json' } }));
      view.replaceChildren();
      for (const entry of entries) {
        const line = document.createElement('span');
        line.className = 'log-line';
        line.textContent = `${entry.time} ${String(entry.level).toUpperCase()} ${entry.message}`;
        view.append(line, document.createTextNode('\n'));
      }
      setStatus(message, `${entries.length} line${entries.length === 1 ? '' : 's'} shown.`);
    } catch (failure) {
      setStatus(message, failure.message, 'error');
    }
  }

  function renderLogPage() {
    app.replaceChildren();
    const card = document.createElement('section');
    card.className = 'card';
    const heading = document.createElement('h2');
    heading.textContent = 'Log';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'button';
    refresh.textContent = 'Refresh log';
    refresh.addEventListener('click', () => { void loadLog(); });
    const message = document.createElement('p');
    message.id = 'log-message';
    message.className = 'status';
    message.setAttribute('role', 'status');
    const view = document.createElement('pre');
    view.id = 'log-view';
    view.className = 'log-view';
    view.setAttribute('aria-label', 'Recent launcher log');
    card.append(heading, refresh, message, view);
    app.append(card);
    void loadLog();
  }

  function selectPage(page) {
    activePage = page;
    for (const button of pageNav.querySelectorAll('button[data-page]')) {
      button.setAttribute('aria-current', button.dataset.page === page ? 'page' : 'false');
    }
    if (page === 'status') renderStatusPage();
    else if (page === 'log') renderLogPage();
    else renderSettings();
    syncStatusPolling();
  }

  function showPageNav() {
    pageNav.replaceChildren();
    for (const [key, name] of PAGES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-quiet';
      button.dataset.page = key;
      button.textContent = name;
      button.addEventListener('click', () => selectPage(key));
      pageNav.append(button);
    }
    const diagnostics = document.createElement('a');
    diagnostics.className = 'diagnostics-link';
    diagnostics.href = '/api/diagnostics';
    diagnostics.download = 'hml-diagnostics.json';
    diagnostics.textContent = 'Download diagnostics';
    pageNav.append(diagnostics);
    pageNav.hidden = false;
  }

  async function loadAuthenticatedPanel() {
    descriptor = await resolveDescriptor(descriptor);
    if (!descriptor) throw new Error('The settings description is unavailable.');
    const config = await readJson(await fetch('/api/config', { headers: { Accept: 'application/json' } }));
    originalSettings = config.settings && typeof config.settings === 'object' ? config.settings : {};
    workingSettings = JSON.parse(JSON.stringify(originalSettings));
    logoutButton.hidden = false;
    showPageNav();
    selectPage(activePage);
  }

  async function start(passedDescriptor) {
    try {
      descriptor = await resolveDescriptor(passedDescriptor);
      const session = await readJson(await fetch('/api/session', { headers: { Accept: 'application/json' } }));
      if (!session.authenticated) {
        showPairForm();
        return;
      }
      await loadAuthenticatedPanel();
    } catch (failure) {
      app.replaceChildren();
      const error = document.createElement('p');
      error.className = 'status status-error';
      error.setAttribute('role', 'alert');
      error.textContent = failure.message;
      app.append(error);
    }
  }

  logoutButton.addEventListener('click', async () => {
    try {
      await readJson(await fetch('/api/logout', { method: 'POST', headers: requestHeaders, body: '{}' }));
      logoutButton.hidden = true;
      showPairForm();
    } catch (failure) {
      window.alert(failure.message);
    }
  });

  start(inlineDescriptor());
}());
