/**
 * Jobs panel — schedule table, queue, timeline, logs DOM (#832 / #834).
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

  function enabledLabel(job) {
    if (job && job.paused) {
      return '일시정지';
    }
    return job && job.enabled ? '예' : '아니오';
  }

  ns.renderHealth = function (health, schedulerRunning) {
    const el = ns.$('jobs-health-summary');
    if (!el) {
      return;
    }
    const h = health || {};
    const uptimeText =
      typeof h.uptimeHuman === 'string' ? '가동 ' + h.uptimeHuman : '가동 —';
    const memoryText =
      typeof h.memoryUsage === 'number'
        ? '메모리 ' + h.memoryUsage.toFixed(1) + '%'
        : '메모리 —';
    el.textContent = [
      schedulerRunning ? '스케줄러 실행 중' : '스케줄러 중지',
      uptimeText,
      '실행 작업 ' + ns.formatNumber(h.runningJobs) + '건',
      '대기 ' + ns.formatNumber(h.queueSize) + '건',
      '오류율 ' + ns.formatRate(h.errorRate),
      memoryText,
    ].join(' · ');
  };

  ns.renderSchedule = function (jobs) {
    const tbody = ns.$('jobs-schedule-tbody');
    const empty = ns.$('jobs-schedule-empty');
    const tableWrap = ns.$('jobs-schedule-table-wrap');
    if (!tbody) {
      return;
    }
    ns.clearNode(tbody);
    const list = Array.isArray(jobs) ? jobs : [];
    if (list.length === 0) {
      ns.setHidden(empty, false);
      ns.setHidden(tableWrap, true);
      ns.syncActionButtons();
      return;
    }
    ns.setHidden(empty, true);
    ns.setHidden(tableWrap, false);
    list.forEach(function (job) {
      const row = document.createElement('tr');
      row.dataset.jobName = job.name || '';
      row.classList.add('is-clickable');
      row.classList.toggle('is-selected', job.name === ns.state.selectedJob);
      appendCell(row, job.name || '');
      appendCell(
        row,
        job.intervalMs == null ? '—' : ns.formatNumber(job.intervalMs),
      );
      appendCell(row, enabledLabel(job));
      appendCell(row, ns.formatIso(job.lastExecution));
      appendCell(row, ns.formatNumber(job.totalExecutions));
      appendCell(row, ns.formatNumber(job.errorCount));
      appendCell(row, job.isRunning ? '예' : '아니오');
      tbody.appendChild(row);
    });
    ns.syncActionButtons();
  };

  /** Issue #833 / #834: durable job_run timeline; Retry on failed rows only. */
  ns.renderTimeline = function (runs, selectedJob) {
    const label = ns.$('jobs-timeline-selected');
    if (label) {
      label.textContent = selectedJob ? selectedJob : '전체 작업';
    }
    const tbody = ns.$('jobs-timeline-tbody');
    if (!tbody) {
      return;
    }
    ns.clearNode(tbody);
    const list = Array.isArray(runs) ? runs : [];
    if (list.length === 0) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = '아직 durable 작업 실행이 없습니다.';
      row.appendChild(td);
      tbody.appendChild(row);
      return;
    }
    list.forEach(function (run) {
      const row = document.createElement('tr');
      row.dataset.runId = run.id || '';
      row.dataset.jobName = run.jobName || '';
      row.classList.add('is-clickable');
      row.classList.toggle('is-selected', run.id === ns.state.selectedRunId);
      appendCell(row, run.jobName || '');
      appendCell(row, run.trigger || '');
      appendCell(row, ns.formatIso(run.startedAt));
      appendCell(row, ns.formatIso(run.endedAt));
      appendCell(row, ns.formatNumber(run.durationMs));
      appendCell(row, run.success ? '성공' : '실패');
      const actions = document.createElement('td');
      if (run.success === false && run.jobName) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'm-button m-button--secondary jobs-retry-btn';
        btn.textContent = '재시도';
        btn.dataset.action = 'retry';
        btn.dataset.jobName = run.jobName;
        actions.appendChild(btn);
      }
      row.appendChild(actions);
      tbody.appendChild(row);
    });
  };

  /** Issue #834: Logs panel for the selected run. */
  ns.renderLogs = function (logs, runId) {
    const label = ns.$('jobs-logs-selected');
    if (label) {
      label.textContent = runId ? runId : '실행 미선택';
    }
    const tbody = ns.$('jobs-logs-tbody');
    if (!tbody) {
      return;
    }
    ns.clearNode(tbody);
    if (!runId) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = '로그를 보려면 타임라인에서 실행을 선택하세요.';
      row.appendChild(td);
      tbody.appendChild(row);
      ns.syncActionButtons();
      return;
    }
    const list = Array.isArray(logs) ? logs : [];
    if (list.length === 0) {
      const row = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = '이 실행의 로그 줄이 없습니다.';
      row.appendChild(td);
      tbody.appendChild(row);
      ns.syncActionButtons();
      return;
    }
    list.forEach(function (entry) {
      const row = document.createElement('tr');
      appendCell(row, ns.formatIso(entry.createdAt || entry.timestamp));
      appendCell(row, entry.level || 'info');
      appendCell(row, entry.message || '');
      tbody.appendChild(row);
    });
    ns.syncActionButtons();
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
      td.textContent = '아직 수동 실행 이력이 없습니다.';
      row.appendChild(td);
      tbody.appendChild(row);
      return;
    }
    list.forEach(function (entry) {
      const row = document.createElement('tr');
      appendCell(row, entry.jobType || '');
      appendCell(row, entry.success ? '성공' : '실패');
      appendCell(row, ns.formatIso(entry.requestedAt || entry.startedAt || entry.timestamp));
      appendCell(row, entry.failureMessage || entry.errorsPreview || entry.error || entry.message || '—');
      tbody.appendChild(row);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
