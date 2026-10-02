/**
 * Jobs panel — boot / refresh wiring (#832 / #834).
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

    const logsRefreshBtn = ns.$('jobs-logs-refresh-btn');
    if (logsRefreshBtn) {
      logsRefreshBtn.addEventListener('click', function () {
        void ns.loadLogs(ns.state.selectedRunId);
      });
    }

    /** Issue #833: click a schedule row → durable timeline for that job. */
    const scheduleTbody = ns.$('jobs-schedule-tbody');
    if (scheduleTbody) {
      scheduleTbody.addEventListener('click', function (event) {
        const target = event.target;
        if (target && target.dataset && target.dataset.action) {
          const jobName = target.dataset.jobName;
          if (target.dataset.action === 'pause') {
            void ns.pauseJob(jobName);
          } else if (target.dataset.action === 'resume') {
            void ns.resumeJob(jobName);
          } else if (target.dataset.action === 'run-now') {
            void ns.runJobNow(jobName);
          }
          return;
        }
        if (target && target.closest && target.closest('.jobs-row-menu')) {
          return;
        }
        const row = target && target.closest ? target.closest('tr') : null;
        const jobName = row && row.dataset ? row.dataset.jobName : null;
        if (jobName) {
          void ns.selectJob(jobName);
        }
      });
    }

    /** Issue #834: timeline row → logs; Retry button → POST /batch/run. */
    const timelineTbody = ns.$('jobs-timeline-tbody');
    if (timelineTbody) {
      timelineTbody.addEventListener('click', function (event) {
        const target = event.target;
        if (target && target.dataset && target.dataset.action === 'retry') {
          const jobName = target.dataset.jobName;
          if (jobName) {
            void ns.retryJob(jobName);
          }
          return;
        }
        const row = target && target.closest ? target.closest('tr') : null;
        const runId = row && row.dataset ? row.dataset.runId : null;
        if (runId) {
          void ns.selectRun(runId, row.dataset.jobName);
        }
      });
    }

    ns.DRAWER_TABS.forEach(function (t) {
      const tabBtn = ns.$('jobs-dtab-' + t);
      if (!tabBtn) {
        return;
      }
      tabBtn.addEventListener('click', function () {
        ns.showDrawerTab(t);
      });
      tabBtn.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
          return;
        }
        event.preventDefault();
        const tabs = ns.DRAWER_TABS;
        const idx = tabs.indexOf(t);
        const nextIdx =
          event.key === 'ArrowRight'
            ? (idx + 1) % tabs.length
            : (idx - 1 + tabs.length) % tabs.length;
        const nextTab = tabs[nextIdx];
        ns.showDrawerTab(nextTab);
        const nextBtn = ns.$('jobs-dtab-' + nextTab);
        if (nextBtn && typeof nextBtn.focus === 'function') {
          nextBtn.focus();
        }
      });
    });

    ns.syncActionButtons();
    ns.renderLogs([], null);
    ns.showDrawerTab('runs');
    ns.renderDrawerHeader();
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
