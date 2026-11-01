/**
 * Settings panel — table, history and read-only list rendering.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_SETTINGS_PANEL__;
  if (!ns) {
    return;
  }
  const S = ns.S;

  function badge(variant, text) {
    return ns.el('span', 'm-badge m-badge--' + variant, text);
  }

  /** Drift: the value comes from the DB or differs from the code default. */
  ns.isDrifted = function (setting) {
    return setting.source === 'override' || setting.value !== setting.default_value;
  };

  /** The input a person edits in a row; select for fixed choices, number or text otherwise. */
  ns.buildInput = function (setting) {
    const current = setting.value === null ? '' : setting.value;
    if (setting.allowed) {
      const select = ns.el('select', 'm-input settings-input');
      if (setting.value === null) {
        const placeholder = ns.el('option', '', S.choose);
        placeholder.value = '';
        select.appendChild(placeholder);
      }
      setting.allowed.forEach(function (choice) {
        const option = ns.el('option', '', choice);
        option.value = choice;
        select.appendChild(option);
      });
      select.value = current;
      return select;
    }
    const input = ns.el('input', 'm-input settings-input');
    if (setting.kind === 'number' && setting.range) {
      input.type = 'number';
      input.step = 'any';
      input.min = String(setting.range.min);
      input.max = String(setting.range.max);
    } else {
      input.type = 'text';
      input.maxLength = 128;
    }
    input.value = current;
    return input;
  };

  function rangeText(range) {
    const left = range.minExclusive ? '(' : '[';
    return S.rangePrefix + left + range.min + ', ' + range.max + ']';
  }

  function keyCell(setting) {
    const cell = ns.el('td');
    cell.appendChild(ns.el('code', 'm-code-inline settings-key', setting.key));
    cell.appendChild(ns.el('div', 'settings-desc', setting.description));
    return cell;
  }

  function valueCell(setting) {
    const cell = ns.el('td');
    cell.appendChild(ns.el('span', 'settings-value', ns.formatValue(setting.value)));
    cell.appendChild(badge(setting.source === 'override' ? 'warn' : 'idle', S.sourceLabel[setting.source]));
    if (ns.isDrifted(setting)) {
      cell.appendChild(badge('warn', S.drift));
    }
    if (setting.pending_restart) {
      cell.appendChild(badge('crit', S.pendingRestart));
    }
    return cell;
  }

  function riskCell(setting) {
    const cell = ns.el('td');
    const variant = { low: 'idle', medium: 'warn', high: 'crit' }[setting.risk];
    cell.appendChild(badge(variant, S.riskLabel[setting.risk]));
    cell.appendChild(badge('idle', setting.apply === 'restart' ? S.applyRestart : S.applyImmediate));
    return cell;
  }

  function lastChangeCell(setting) {
    const cell = ns.el('td');
    const change = setting.last_change;
    if (!change) {
      cell.textContent = S.none;
      return cell;
    }
    cell.appendChild(ns.el('div', '', S.actionLabel[change.action] + ' / ' + change.actor));
    cell.appendChild(ns.el('div', 'settings-desc', ns.formatTime(change.created_at)));
    if (change.reason) {
      cell.appendChild(ns.el('div', 'settings-desc', change.reason));
    }
    return cell;
  }

  function editCell(setting) {
    const cell = ns.el('td', 'settings-edit');
    const input = ns.buildInput(setting);
    input.setAttribute('aria-label', setting.key);
    cell.appendChild(input);
    if (setting.range) {
      cell.appendChild(ns.el('div', 'settings-desc', rangeText(setting.range)));
    }
    const change = ns.el('button', 'm-button m-button--secondary settings-btn', S.change);
    change.type = 'button';
    change.addEventListener('click', function () {
      ns.requestChange(setting, input.value);
    });
    cell.appendChild(change);
    if (setting.override) {
      const revert = ns.el('button', 'm-button m-button--ghost settings-btn', S.revert);
      revert.type = 'button';
      revert.addEventListener('click', function () {
        ns.requestRevert(setting);
      });
      cell.appendChild(revert);
    }
    return cell;
  }

  ns.renderSettings = function () {
    const tbody = ns.$('settings-tbody');
    ns.clearNode(tbody);
    ns.state.settings.forEach(function (setting) {
      const row = ns.el('tr');
      row.dataset.key = setting.key;
      row.appendChild(keyCell(setting));
      row.appendChild(valueCell(setting));
      row.appendChild(ns.el('td', '', ns.formatValue(setting.default_value) + ' (' + setting.default_source + ')'));
      row.appendChild(riskCell(setting));
      row.appendChild(lastChangeCell(setting));
      row.appendChild(editCell(setting));
      tbody.appendChild(row);
    });
  };

  ns.renderReadOnly = function () {
    const list = ns.$('settings-readonly-list');
    ns.clearNode(list);
    ns.state.readOnly.forEach(function (entry) {
      const shown = entry.secret ? (entry.set ? S.secretSet : S.unset) : entry.set ? entry.value : S.unset;
      const row = ns.el('div', 'settings-readonly__row');
      row.appendChild(ns.el('dt', 'm-code-inline', entry.key));
      row.appendChild(ns.el('dd', '', shown));
      list.appendChild(row);
    });
  };

  /** Rebuild the filter choices, keeping the current selection when its key still exists. */
  ns.renderEventsFilter = function () {
    const select = ns.$('settings-events-key');
    ns.clearNode(select);
    const all = ns.el('option', '', S.allKeys);
    all.value = '';
    select.appendChild(all);
    ns.state.settings.forEach(function (setting) {
      const option = ns.el('option', '', setting.key);
      option.value = setting.key;
      select.appendChild(option);
    });
    select.value = ns.state.eventsKey;
  };

  ns.renderEvents = function (events) {
    const tbody = ns.$('settings-events-tbody');
    ns.clearNode(tbody);
    ns.setHidden(ns.$('settings-events-empty'), events.length > 0);
    events.forEach(function (event) {
      const row = ns.el('tr');
      row.dataset.eventId = event.id;
      [
        ns.formatTime(event.created_at),
        event.setting_key,
        S.actionLabel[event.action],
        ns.formatValue(event.previous_value),
        event.action === 'revert' ? S.none : ns.formatValue(event.new_value),
        event.actor,
        event.reason || S.none,
      ].forEach(function (text) {
        row.appendChild(ns.el('td', '', text));
      });
      tbody.appendChild(row);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
