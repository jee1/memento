/**
 * Jobs panel — shared URLs, DOM helpers, state (#832 / #834).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_JOBS_PANEL__ = global.__MEMENTO_JOBS_PANEL__ || {});

  ns.STATS_URL = '/admin/batch/stats';
  ns.STATUS_URL = '/admin/status';
  ns.RUN_HISTORY_URL = '/admin/batch/run-history?limit=50';
  ns.RUNS_URL = '/admin/batch/runs';
  ns.PAUSE_URL = '/admin/batch/pause';
  ns.RESUME_URL = '/admin/batch/resume';
  ns.RUN_URL = '/admin/batch/run';

  // Korean UI strings (#1152). Code references ns.S.* only; edit text here, not in the logic.
  ns.S = {
    allJobs: '전체 작업',
    runPrefix: ' › 실행 ',
    rowMenuLabel: function (name) {
      return name + ' 동작';
    },
    pause: '일시정지',
    resume: '재개',
    runNow: '지금 실행',
    stateRunning: '실행 중',
    statePaused: '일시정지',
    stateErrors: function (n) {
      return '오류 ' + n + '건';
    },
    stateOk: '정상',
    kpiRunning: '실행 중',
    kpiRunningNote: '지금 실행 중인 작업',
    kpiFailed: '실패 실행',
    kpiFailedNote: '최근 30일',
    kpiImpact: '배치 영향 시간',
    kpiImpactNote: '실패한 배치 실행의 소요 시간 합 — 서비스 중단 시간이 아님 · 최근 30일',
    kpiUnavailable: '확인 불가',
  };

  ns.DRAWER_TABS = ['runs', 'logs', 'history'];

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
    readOnly: false,
    drawerTab: 'runs',
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

  ns.setLoading = function (loading) {
    const el = ns.$('jobs-loading');
    ns.setHidden(el, !loading);
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

  ns.showDrawerTab = function (name) {
    ns.DRAWER_TABS.forEach(function (t) {
      const btn = ns.$('jobs-dtab-' + t);
      const panel = ns.$('jobs-dpanel-' + t);
      if (btn) {
        btn.setAttribute('aria-selected', String(t === name));
        btn.setAttribute('tabindex', t === name ? '0' : '-1');
      }
      ns.setHidden(panel, t !== name);
    });
    ns.state.drawerTab = name;
  };

  ns.jobState = function (job) {
    if (job.isRunning) {
      return { variant: 'ok', label: ns.S.stateRunning };
    }
    if (job.paused || job.enabled === false) {
      return { variant: 'idle', label: ns.S.statePaused };
    }
    if (job.errorCount > 0) {
      return { variant: 'warn', label: ns.S.stateErrors(job.errorCount) };
    }
    return { variant: 'ok', label: ns.S.stateOk };
  };

  ns.renderDrawerHeader = function () {
    const S = ns.S;
    const jobEl = ns.$('jobs-drawer-job');
    if (jobEl) {
      jobEl.textContent = ns.state.selectedJob || S.allJobs;
    }
    const runEl = ns.$('jobs-drawer-run');
    if (runEl) {
      if (ns.state.selectedRunId) {
        runEl.textContent = S.runPrefix + ns.state.selectedRunId;
        ns.setHidden(runEl, false);
      } else {
        runEl.textContent = '';
        ns.setHidden(runEl, true);
      }
    }
    const badgeEl = ns.$('jobs-drawer-badge');
    if (badgeEl) {
      const jobs = (ns.state.lastStats || {}).jobs;
      const list = Array.isArray(jobs) ? jobs : [];
      const job = ns.state.selectedJob
        ? list.find(function (j) {
            return j && j.name === ns.state.selectedJob;
          })
        : null;
      if (job) {
        const state = ns.jobState(job);
        badgeEl.className = 'm-badge m-badge--' + state.variant;
        badgeEl.textContent = state.label;
        ns.setHidden(badgeEl, false);
      } else {
        ns.setHidden(badgeEl, true);
      }
    }
  };

  ns.syncActionButtons = function () {
    const hasRun = Boolean(ns.state.selectedRunId);
    const busy = Boolean(ns.state.writeInFlight);
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
