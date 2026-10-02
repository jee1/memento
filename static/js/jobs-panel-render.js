/**
 * Jobs panel — schedule table, queue, timeline, logs DOM (#832 / #834).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_JOBS_PANEL__;
  if (!ns) {
    return;
  }

  const S = ns.S;

  function appendCell(row, text) {
    const td = document.createElement('td');
    td.textContent = text == null ? '' : String(text);
    row.appendChild(td);
    return td;
  }

  function appendStat(container, label, value, note) {
    const stat = document.createElement('div');
    stat.className = 'm-stat';
    const labelEl = document.createElement('div');
    labelEl.className = 'm-stat__label';
    labelEl.textContent = label;
    stat.appendChild(labelEl);
    const valueEl = document.createElement('div');
    valueEl.className = 'm-stat__value';
    valueEl.textContent = value == null ? '—' : String(value);
    stat.appendChild(valueEl);
    const noteEl = document.createElement('div');
    noteEl.className = 'm-stat__note';
    noteEl.textContent = note;
    stat.appendChild(noteEl);
    container.appendChild(stat);
  }

  ns.renderKpis = function (stats, status) {
    const container = ns.$('jobs-kpis');
    if (!container) {
      return;
    }
    ns.clearNode(container);
    const b = status && status.batchImpact;
    const batchOk = b && b.status === 'ok';
    appendStat(
      container,
      S.kpiRunning,
      ns.formatNumber((stats.health || {}).runningJobs),
      S.kpiRunningNote,
    );
    if (batchOk) {
      appendStat(container, S.kpiFailed, ns.formatNumber(b.failedRunCount), S.kpiFailedNote);
      appendStat(container, S.kpiImpact, b.durationHuman || '—', S.kpiImpactNote);
    } else {
      appendStat(container, S.kpiFailed, '—', S.kpiUnavailable);
      appendStat(container, S.kpiImpact, '—', S.kpiUnavailable);
    }
  };

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
      const name = job.name || '';
      const row = document.createElement('tr');
      row.dataset.jobName = name;
      row.classList.add('is-clickable');
      row.classList.toggle('is-selected', name === ns.state.selectedJob);
      const state = ns.jobState(job);
      const stateTd = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'm-badge m-badge--' + state.variant;
      badge.textContent = state.label;
      stateTd.appendChild(badge);
      row.appendChild(stateTd);
      appendCell(row, name);
      appendCell(
        row,
        job.intervalMs == null ? '—' : ns.formatNumber(job.intervalMs),
      );
      appendCell(row, ns.formatIso(job.lastExecution));
      appendCell(row, ns.formatNumber(job.errorCount));
      const actionsTd = document.createElement('td');
      if (!ns.state.readOnly) {
        const menu = document.createElement('details');
        menu.className = 'jobs-row-menu';
        const summary = document.createElement('summary');
        summary.className = 'm-button m-button--ghost jobs-row-menu__toggle';
        summary.textContent = '⋯';
        summary.setAttribute('aria-label', S.rowMenuLabel(name));
        menu.appendChild(summary);
        const listEl = document.createElement('div');
        listEl.className = 'jobs-row-menu__list';
        const pauseResume = document.createElement('button');
        pauseResume.type = 'button';
        pauseResume.className = 'm-button m-button--secondary';
        pauseResume.disabled = Boolean(ns.state.writeInFlight);
        pauseResume.dataset.jobName = name;
        if (job.paused) {
          pauseResume.dataset.action = 'resume';
          pauseResume.textContent = S.resume;
        } else {
          pauseResume.dataset.action = 'pause';
          pauseResume.textContent = S.pause;
        }
        listEl.appendChild(pauseResume);
        const runNow = document.createElement('button');
        runNow.type = 'button';
        runNow.className = 'm-button m-button--secondary';
        runNow.dataset.action = 'run-now';
        runNow.dataset.jobName = name;
        runNow.disabled = Boolean(ns.state.writeInFlight);
        runNow.textContent = S.runNow;
        listEl.appendChild(runNow);
        menu.appendChild(listEl);
        actionsTd.appendChild(menu);
      }
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });
    ns.syncActionButtons();
  };

  /** Issue #833 / #834: durable job_run timeline; Retry on failed rows only. */
  ns.renderTimeline = function (runs) {
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
      if (!ns.state.readOnly && run.success === false && run.jobName) {
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
