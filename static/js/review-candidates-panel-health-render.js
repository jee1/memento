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
      '<div class="rc-health-metric-card"><div class="rc-health-metric-label">' +
      ns.escapeHtml(label) +
      '</div><div class="rc-health-metric-value">' +
      ns.escapeHtml(String(value)) +
      '</div></div>'
    );
  }

  function renderLiveHealthHtml(live) {
    const w1 = live && live.window1h ? live.window1h : {};
    const w24 = live && live.window24h ? live.window24h : {};
    const cards = [];
    cards.push(formatHealthMetricCard('Pending now', live && live.pendingTotal != null ? live.pendingTotal : '—'));
    cards.push(formatHealthMetricCard('Created (1h)', w1.candidatesCreated != null ? w1.candidatesCreated : '—'));
    cards.push(formatHealthMetricCard('Processed (1h)', w1.processedTotal != null ? w1.processedTotal : '—'));
    cards.push(formatHealthMetricCard('Net flow (1h)', w1.netFlow != null ? w1.netFlow : '—'));
    cards.push(formatHealthMetricCard('Processed / created (1h)', ratioText(w1.processingRatio)));
    cards.push(formatHealthMetricCard('Created (24h)', w24.candidatesCreated != null ? w24.candidatesCreated : '—'));
    cards.push(formatHealthMetricCard('Processed (24h)', w24.processedTotal != null ? w24.processedTotal : '—'));
    cards.push(formatHealthMetricCard('Processed / created (24h)', ratioText(w24.processingRatio)));
    return '<div class="rc-health-metric-grid">' + cards.join('') + '</div>';
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

  ns.renderLiveHealthHtml = renderLiveHealthHtml;
  ns.renderHealthSnapshotsTable = renderHealthSnapshotsTable;
  ns.renderBatchRunHistoryTable = renderBatchRunHistoryTable;
})(typeof window !== 'undefined' ? window : globalThis);
