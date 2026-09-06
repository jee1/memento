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
    /** Issue #833: click a schedule row → durable timeline for that job. */
    const scheduleTbody = ns.$('jobs-schedule-tbody');
    if (scheduleTbody) {
      scheduleTbody.addEventListener('click', function (event) {
        const row = event.target && event.target.closest ? event.target.closest('tr') : null;
        const jobName = row && row.dataset ? row.dataset.jobName : null;
        if (jobName) {
          void ns.selectJob(jobName);
        }
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
