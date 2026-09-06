/**
 * Jobs panel — schedule table, queue summary, run-history DOM (#832).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_JOBS_PANEL__;
  if (!ns) {
    return;
  }

  function appendCell(row, text) {
    const td = document.createElement('td');
    td.textContent = text == null ? '' : String(text);
    row.appendChild(td);
    return td;
  }

  ns.renderHealth = function (health, schedulerRunning) {
    const el = ns.$('jobs-health-summary');
    if (!el) {
      return;
    }
    const h = health || {};
    el.textContent =
      'Scheduler: ' +
      (schedulerRunning ? 'running' : 'stopped') +
      ' · runningJobs=' +
      ns.formatNumber(h.runningJobs) +
      ' · queueSize=' +
      ns.formatNumber(h.queueSize) +
      ' · errorRate=' +
      ns.formatRate(h.errorRate) +
      ' · uptimeMs=' +
      ns.formatNumber(h.uptime) +
      ' · memory%=' +
      (typeof h.memoryUsage === 'number' ? h.memoryUsage.toFixed(1) : '—');
  };

  ns.renderSchedule = function (jobs) {
    const tbody = ns.$('jobs-schedule-tbody');
    if (!tbody) {
      return;
    }
    ns.clearNode(tbody);
    const list = Array.isArray(jobs) ? jobs : [];
    if (list.length === 0) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No scheduled jobs.';
      row.appendChild(td);
      tbody.appendChild(row);
      return;
    }
    list.forEach(function (job) {
      const row = document.createElement('tr');
      appendCell(row, job.name || '');
      appendCell(
        row,
        job.intervalMs == null ? '—' : ns.formatNumber(job.intervalMs),
      );
      appendCell(row, job.enabled ? 'yes' : 'no');
      appendCell(row, ns.formatIso(job.lastExecution));
      appendCell(row, ns.formatNumber(job.totalExecutions));
      appendCell(row, ns.formatNumber(job.errorCount));
      appendCell(row, job.isRunning ? 'yes' : 'no');
      tbody.appendChild(row);
    });
  };

  ns.renderQueue = function (queue) {
    const el = ns.$('jobs-queue-summary');
    if (!el) {
      return;
    }
    const q = queue || {};
    const running = Array.isArray(q.runningNames) ? q.runningNames.join(', ') : '';
    const queued = Array.isArray(q.queuedNames) ? q.queuedNames.join(', ') : '';
    el.textContent =
      'size=' +
      ns.formatNumber(q.size) +
      ' · runningCount=' +
      ns.formatNumber(q.runningCount) +
      ' · running=[' +
      (running || '—') +
      '] · queued=[' +
      (queued || '—') +
      ']';
  };

  ns.renderRunHistory = function (entries) {
    const tbody = ns.$('jobs-run-history-tbody');
    if (!tbody) {
      return;
    }
    ns.clearNode(tbody);
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = 'No manual run history yet.';
      row.appendChild(td);
      tbody.appendChild(row);
      return;
    }
    list.forEach(function (entry) {
      const row = document.createElement('tr');
      appendCell(row, entry.jobType || '');
      appendCell(row, entry.success ? 'ok' : 'fail');
      appendCell(row, ns.formatIso(entry.requestedAt || entry.startedAt || entry.timestamp));
      appendCell(row, entry.failureMessage || entry.errorsPreview || entry.error || entry.message || '—');
      tbody.appendChild(row);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
