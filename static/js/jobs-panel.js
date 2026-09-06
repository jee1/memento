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

    const pauseBtn = ns.$('jobs-pause-btn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        void ns.pauseSelectedJob();
      });
    }
    const resumeBtn = ns.$('jobs-resume-btn');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', function () {
        void ns.resumeSelectedJob();
      });
    }
    const runNowBtn = ns.$('jobs-run-now-btn');
    if (runNowBtn) {
      runNowBtn.addEventListener('click', function () {
        void ns.runSelectedJobNow();
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
        const row = event.target && event.target.closest ? event.target.closest('tr') : null;
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

    ns.syncActionButtons();
    ns.renderLogs([], null);
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
