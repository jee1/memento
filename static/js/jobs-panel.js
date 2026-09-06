/**
 * Jobs panel — boot / refresh wiring (#832).
 * Manual Refresh only; first tab open may fetch once (user-driven).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_JOBS_PANEL__;
  if (!ns) {
    return;
  }

  function wirePanel() {
    const btn = ns.$('jobs-refresh-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        void ns.refresh();
      });
    }
  }

  function initJobsPanel() {
    if (!ns.state.wired) {
      ns.state.wired = true;
      wirePanel();
    }
    if (!ns.state.loadedOnce) {
      ns.state.loadedOnce = true;
      void ns.refresh();
    }
  }

  global.initJobsPanel = initJobsPanel;
})(typeof window !== 'undefined' ? window : globalThis);
