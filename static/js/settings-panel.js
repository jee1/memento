/**
 * Settings panel — load, confirm dialog, save and revert wiring.
 * Every change and revert goes through the dialog; the reason is required before any request is sent.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_SETTINGS_PANEL__;
  if (!ns) {
    return;
  }
  const S = ns.S;

  function eventsUrl() {
    return ns.state.eventsKey
      ? ns.EVENTS_URL + '?key=' + encodeURIComponent(ns.state.eventsKey)
      : ns.EVENTS_URL;
  }

  ns.loadEvents = function () {
    return ns.request('GET', eventsUrl()).then(function (result) {
      if (!result.ok) {
        ns.setError(S.failure(result.data, result.status));
        return;
      }
      ns.renderEvents(result.data.events || []);
    });
  };

  ns.refresh = function () {
    const generation = ++ns.state.refreshGeneration;
    ns.setLoading(true);
    ns.setError('');
    return ns
      .request('GET', ns.SETTINGS_URL)
      .then(function (result) {
        if (generation !== ns.state.refreshGeneration) {
          return null;
        }
        if (!result.ok) {
          ns.setError(S.failure(result.data, result.status));
          return null;
        }
        ns.state.settings = result.data.settings || [];
        ns.state.readOnly = result.data.read_only || [];
        ns.renderSettings();
        ns.renderReadOnly();
        ns.renderEventsFilter();
        return ns.loadEvents();
      })
      .catch(function () {
        ns.setError(S.loadFailed);
      })
      .then(function () {
        if (generation === ns.state.refreshGeneration) {
          ns.setLoading(false);
        }
      });
  };

  function dialogNotes(setting, mode) {
    const notes = [];
    if (setting.risk === 'medium' || setting.risk === 'high') {
      notes.push({ className: 'settings-note settings-note--strong', text: S.riskLabel[setting.risk] + '. ' + S.noteStrong });
    }
    if (setting.apply === 'restart') {
      notes.push({ className: 'settings-note', text: S.noteRestart });
    }
    if (mode === 'revert') {
      notes.push({ className: 'settings-note', text: S.noteRevert });
    }
    return notes;
  }

  function showDialog(context) {
    ns.state.dialog = context;
    const setting = context.setting;
    const dialog = ns.$('settings-dialog');
    ns.$('settings-dialog-title').textContent =
      context.mode === 'set' ? S.dialogTitleSet(setting.key) : S.dialogTitleRevert(setting.key);
    ns.$('settings-dialog-summary').textContent = S.dialogSummary(
      ns.formatValue(setting.value),
      ns.formatValue(context.nextValue),
    );
    const notes = ns.$('settings-dialog-notes');
    ns.clearNode(notes);
    dialogNotes(setting, context.mode).forEach(function (note) {
      notes.appendChild(ns.el('p', note.className, note.text));
    });
    ns.$('settings-dialog-reason').value = '';
    ns.setDialogError('');
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  ns.setDialogError = function (message) {
    const el = ns.$('settings-dialog-error');
    el.textContent = message || '';
    ns.setHidden(el, !message);
  };

  function closeDialog() {
    const dialog = ns.$('settings-dialog');
    ns.state.dialog = null;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  ns.requestChange = function (setting, rawValue) {
    const value = String(rawValue).trim();
    if (value === setting.value) {
      ns.setError(S.sameValuePin || S.sameValue);
      return;
    }
    ns.setError('');
    showDialog({ mode: 'set', setting: setting, nextValue: value });
  };

  ns.requestRevert = function (setting) {
    ns.setError('');
    const restored =
      setting.revert_target_value !== undefined && setting.revert_target_value !== null
        ? setting.revert_target_value
        : setting.env_value !== null
          ? setting.env_value
          : setting.default_value;
    showDialog({ mode: 'revert', setting: setting, nextValue: restored });
  };

  ns.confirmDialog = function () {
    const context = ns.state.dialog;
    if (!context || ns.state.inFlight) {
      return Promise.resolve();
    }
    const reason = ns.$('settings-dialog-reason').value.trim();
    if (reason === '') {
      ns.setDialogError(S.reasonRequired);
      return Promise.resolve();
    }
    const base = ns.SETTINGS_URL + '/' + encodeURIComponent(context.setting.key);
    ns.state.inFlight = true;
    ns.setDialogError('');
    const sent =
      context.mode === 'set'
        ? ns.request('PUT', base, { value: context.nextValue, reason: reason })
        : ns.request('POST', base + '/revert', { reason: reason });
    return sent
      .then(function (result) {
        if (!result.ok) {
          ns.setDialogError(S.failure(result.data, result.status));
          return null;
        }
        closeDialog();
        return ns.refresh();
      })
      .catch(function () {
        ns.setDialogError(S.loadFailed);
      })
      .then(function () {
        ns.state.inFlight = false;
      });
  };

  function wirePanel() {
    ns.$('settings-refresh-btn').addEventListener('click', function () {
      void ns.refresh();
    });
    ns.$('settings-dialog-confirm').addEventListener('click', function () {
      void ns.confirmDialog();
    });
    ns.$('settings-dialog-cancel').addEventListener('click', closeDialog);
    const filter = ns.$('settings-events-key');
    filter.addEventListener('change', function () {
      ns.state.eventsKey = filter.value;
      void ns.loadEvents();
    });
  }

  function initSettingsPanel() {
    if (!ns.state.wired) {
      ns.state.wired = true;
      wirePanel();
    }
    if (!ns.state.loadedOnce) {
      ns.state.loadedOnce = true;
      void ns.refresh();
    }
  }

  global.initSettingsPanel = initSettingsPanel;
})(typeof window !== 'undefined' ? window : globalThis);
