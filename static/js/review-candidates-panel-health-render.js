/**
 * Review candidates panel — health metrics render (#294, #295, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  function ratioText(ratio) {
    if (ratio == null || Number.isNaN(Number(ratio))) {
      return '—';
    }
    return Number(ratio).toFixed(2);
  }

  function formatHealthMetricCard(label, value) {
    return (
      '<div class="m-metric"><div class="m-metric__label">' +
      ns.escapeHtml(label) +
      '</div><div class="m-metric__value">' +
      ns.escapeHtml(String(value)) +
      '</div></div>'
    );
  }

  function isWindow1hMetricNumber(value) {
    return typeof value === 'number' && !Number.isNaN(value);
  }

  function computeQueueVerdict(live) {
    const w1 = live && live.window1h ? live.window1h : {};
    const candidatesCreated = w1.candidatesCreated;
    const processedTotal = w1.processedTotal;
    const netFlow = w1.netFlow;

    if (
      !isWindow1hMetricNumber(candidatesCreated) ||
      !isWindow1hMetricNumber(processedTotal) ||
      !isWindow1hMetricNumber(netFlow)
    ) {
      return {
        state: 'unknown',
        label: '확인 필요',
        action: '지표를 불러오지 못했습니다. 새로고침하거나 서버 로그를 확인하십시오.',
      };
    }
    if (processedTotal === 0 && candidatesCreated > 0) {
      return {
        state: 'stalled',
        label: '처리 없음',
        action: '1시간 동안 생성만 되고 처리가 없습니다. 검토자를 배정하거나 일괄 무시로 줄이십시오.',
      };
    }
    if (netFlow > 0) {
      return {
        state: 'growing',
        label: 'backlog 증가',
        action: '생성이 처리를 앞지릅니다. 이 속도가 이어지면 대기열이 계속 늘어납니다.',
      };
    }
    return {
      state: 'healthy',
      label: '정상',
      action: '처리가 생성을 따라잡고 있습니다. 조치가 필요 없습니다.',
    };
  }

  function renderQueueVerdictBanner(verdict) {
    return (
      '<div class="rc-queue-verdict rc-queue-verdict--' +
      verdict.state +
      '" role="status">' +
      '<strong class="rc-queue-verdict__label">' +
      ns.escapeHtml(verdict.label) +
      '</strong>' +
      '<span class="rc-queue-verdict__action">' +
      ns.escapeHtml(verdict.action) +
      '</span>' +
      '</div>'
    );
  }

  function renderLiveHealthHtml(live) {
    const w1 = live && live.window1h ? live.window1h : {};
    const w24 = live && live.window24h ? live.window24h : {};
    const cards = [];
    cards.push(formatHealthMetricCard('현재 대기', live && live.pendingTotal != null ? live.pendingTotal : '—'));
    cards.push(formatHealthMetricCard('생성 (1h)', w1.candidatesCreated != null ? w1.candidatesCreated : '—'));
    cards.push(formatHealthMetricCard('처리 (1h)', w1.processedTotal != null ? w1.processedTotal : '—'));
    cards.push(formatHealthMetricCard('순유입 (1h)', w1.netFlow != null ? w1.netFlow : '—'));
    cards.push(formatHealthMetricCard('처리/생성 (1h)', ratioText(w1.processingRatio)));
    cards.push(formatHealthMetricCard('생성 (24h)', w24.candidatesCreated != null ? w24.candidatesCreated : '—'));
    cards.push(formatHealthMetricCard('처리 (24h)', w24.processedTotal != null ? w24.processedTotal : '—'));
    cards.push(formatHealthMetricCard('처리/생성 (24h)', ratioText(w24.processingRatio)));
    const verdict = computeQueueVerdict(live);
    return renderQueueVerdictBanner(verdict) + '<div class="m-metric-grid">' + cards.join('') + '</div>';
  }

  /** @param {unknown[]} snaps */
  function renderHealthSnapshotsTable(snaps) {
    const tbody = document.querySelector('#rc-health-history-table tbody');
    if (!tbody) {
      return;
    }
    tbody.innerHTML = '';
    if (!snaps || !snaps.length) {
      return;
    }
    for (let i = 0; i < snaps.length; i++) {
      const s = /** @type {Record<string, unknown>} */ (snaps[i]);
      const tr = document.createElement('tr');
      const proc1 =
        Number(s.reviewed_last_1h || 0) +
        Number(s.dismissed_last_1h || 0) +
        Number(s.expired_last_1h || 0);
      tr.innerHTML =
        '<td class="rc-cell-mono">' +
        ns.escapeHtml(String(s.sampled_at || '')) +
        '</td><td>' +
        ns.escapeHtml(String(s.pending_total != null ? s.pending_total : '')) +
        '</td><td>' +
        ns.escapeHtml(String(s.net_flow_1h != null ? s.net_flow_1h : '')) +
        '</td><td>' +
        ns.escapeHtml(String(s.created_last_1h != null ? s.created_last_1h : '')) +
        '</td><td>' +
        ns.escapeHtml(String(proc1)) +
        '</td>';
      tbody.appendChild(tr);
    }
  }

  function formatDurationMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) {
      return '—';
    }
    if (n < 1000) {
      return String(Math.round(n)) + ' ms';
    }
    return (n / 1000).toFixed(2) + ' s';
  }

  /** @param {unknown[]} rows */
  function renderBatchRunHistoryTable(rows) {
    const tbody = document.querySelector('#rc-batch-history-table tbody');
    if (!tbody) {
      return;
    }
    tbody.innerHTML = '';
    if (!rows || !rows.length) {
      return;
    }
    for (let i = 0; i < rows.length; i++) {
      const r = /** @type {Record<string, unknown>} */ (rows[i]);
      const tr = document.createElement('tr');
      const errPreview = String(r.errorsPreview || r.failureMessage || '');
      const errCell =
        (Number(r.errorCount) > 0 || errPreview ? ns.escapeHtml(errPreview || '(see logs)') : '—') +
        (Number(r.warningCount) > 0
          ? ' <span class="rc-health-hint">(' + ns.escapeHtml(String(r.warningCount)) + ' warnings)</span>'
          : '');
      tr.innerHTML =
        '<td class="rc-cell-mono">' +
        ns.escapeHtml(ns.formatDue(r.completedAt)) +
        '</td><td class="rc-cell-mono">' +
        ns.escapeHtml(String(r.jobType || '')) +
        '</td><td>' +
        ns.escapeHtml(r.success === true ? 'yes' : r.success === false ? 'no' : '—') +
        '</td><td class="rc-cell-mono">' +
        ns.escapeHtml(formatDurationMs(r.durationMs)) +
        '</td><td>' +
        ns.escapeHtml(String(r.processed != null ? r.processed : '—')) +
        '</td><td class="rc-preview-reason-full">' +
        errCell +
        '</td>';
      tbody.appendChild(tr);
    }
  }

  ns.computeQueueVerdict = computeQueueVerdict;
  ns.renderLiveHealthHtml = renderLiveHealthHtml;
  ns.renderHealthSnapshotsTable = renderHealthSnapshotsTable;
  ns.renderBatchRunHistoryTable = renderBatchRunHistoryTable;
})(typeof window !== 'undefined' ? window : globalThis);
