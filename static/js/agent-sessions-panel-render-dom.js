/**
 * Agent session dashboard render DOM helpers (#460).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_AGENT_SESSIONS_PANEL__;
  if (!ns) {
    return;
  }

  function number(value) {
    return Number.isFinite(Number(value)) ? String(Number(value)) : '0';
  }

  function setCount(id, value) {
    const element = ns.$(id);
    if (element) {
      element.textContent = number(value);
    }
  }

  function addBadge(parent, label, modifier) {
    return ns.appendText(parent, 'span', label, 'as-state-badge as-state-badge--' + modifier);
  }

  function addDefinition(list, term, value) {
    const row = document.createElement('div');
    ns.appendText(row, 'dt', term);
    ns.appendText(row, 'dd', value == null || value === '' ? '—' : String(value));
    list.appendChild(row);
  }

  function sessionAggregate(session) {
    return session.aggregate || session.observation_aggregate || {};
  }

  ns.renderDom = {
    number: number,
    setCount: setCount,
    addBadge: addBadge,
    addDefinition: addDefinition,
    sessionAggregate: sessionAggregate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
