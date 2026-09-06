/**
 * Jobs panel — shared URLs, DOM helpers, state (#832 / #834).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_JOBS_PANEL__ = global.__MEMENTO_JOBS_PANEL__ || {});

  ns.STATS_URL = '/admin/batch/stats';
  ns.RUN_HISTORY_URL = '/admin/batch/run-history?limit=50';
  ns.RUNS_URL = '/admin/batch/runs';
  ns.PAUSE_URL = '/admin/batch/pause';
  ns.RESUME_URL = '/admin/batch/resume';
  ns.RUN_URL = '/admin/batch/run';

  ns.state = ns.state || {
    wired: false,
    loadedOnce: false,
    lastStats: null,
    lastHistory: null,
    lastRuns: null,
    lastLogs: null,
    selectedJob: null,
    selectedRunId: null,
    selectedRunJobName: null,
    refreshGeneration: 0,
    writeInFlight: false,
  };

  ns.$ = function (id) {
    return document.getElementById(id);
  };

  ns.setHidden = function (element, hidden) {
    if (!element) {
      return;
    }
    element.classList.toggle('hidden', hidden);
  };

  ns.clearNode = function (element) {
    if (element && typeof element.replaceChildren === 'function') {
      element.replaceChildren();
    } else if (element) {
      element.textContent = '';
    }
  };

  ns.formatIso = function (value) {
    if (!value) {
      return '—';
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  };

  ns.formatNumber = function (value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '—';
    }
    return String(value);
  };

  ns.formatRate = function (value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '—';
    }
    return (value * 100).toFixed(2) + '%';
  };

  ns.setStatus = function (message) {
    const line = ns.$('jobs-status-line');
    if (line) {
      line.textContent = message || '';
    }
  };

  /** Issue #833: durable job_run timeline URL, optionally filtered by job name. */
  ns.buildRunsUrl = function (jobName) {
    const limit = 'limit=50';
    if (jobName) {
      return ns.RUNS_URL + '?job=' + encodeURIComponent(jobName) + '&' + limit;
    }
    return ns.RUNS_URL + '?' + limit;
  };

  /** Issue #834: structured logs for a selected durable run. */
  ns.buildLogsUrl = function (runId) {
    return ns.RUNS_URL + '/' + encodeURIComponent(runId) + '/logs?limit=200';
  };

  ns.confirmWrite = function (message) {
    if (typeof global.confirm !== 'function') {
      return true;
    }
    return global.confirm(message);
  };

  ns.syncActionButtons = function () {
    const hasJob = Boolean(ns.state.selectedJob);
    const hasRun = Boolean(ns.state.selectedRunId);
    const busy = Boolean(ns.state.writeInFlight);
    ['jobs-pause-btn', 'jobs-resume-btn', 'jobs-run-now-btn'].forEach(function (id) {
      const btn = ns.$(id);
      if (btn) {
        btn.disabled = !hasJob || busy;
      }
    });
    const logsRefresh = ns.$('jobs-logs-refresh-btn');
    if (logsRefresh) {
      logsRefresh.disabled = !hasRun || busy;
    }
  };

  ns.setError = function (message) {
    const el = ns.$('jobs-error');
    if (!el) {
      return;
    }
    if (message) {
      el.textContent = message;
      ns.setHidden(el, false);
    } else {
      el.textContent = '';
      ns.setHidden(el, true);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
