/**
 * Dashboard tab panel visibility (aria-hidden / active classes).
 */
(function (global) {
  'use strict';

  const TAB_PANELS = [
    { name: 'evolution-demo', id: 'tab-evolution-demo' },
    { name: 'anchor', id: 'tab-anchor-map' },
    { name: 'embedding', id: 'tab-embedding-map' },
    { name: 'graph', id: 'tab-graph' },
    { name: 'review', id: 'tab-review-candidates' },
    { name: 'agent-sessions', id: 'tab-agent-sessions' },
  ];

  function getPanel(name) {
    const entry = TAB_PANELS.find(function (p) {
      return p.name === name;
    });
    return entry ? document.getElementById(entry.id) : null;
  }

  function setTabButtonsActive(name) {
    document.querySelectorAll('.m-tab-btn').forEach(function (b) {
      const on = b.getAttribute('data-tab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function setPanelVisibility(name) {
    TAB_PANELS.forEach(function (entry) {
      const panel = document.getElementById(entry.id);
      if (!panel) {
        return;
      }
      const on = entry.name === name;
      panel.classList.toggle('active', on);
      panel.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
  }

  global.__MEMENTO_DASHBOARD_TAB_PANELS__ = {
    TAB_PANELS: TAB_PANELS,
    getPanel: getPanel,
    setTabButtonsActive: setTabButtonsActive,
    setPanelVisibility: setPanelVisibility,
  };
})(typeof window !== 'undefined' ? window : globalThis);
