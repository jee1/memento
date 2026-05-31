/**
 * Review candidates panel — queue health metrics and batch run history (#294, #295).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  const $ = ns.$;
  const setHidden = ns.setHidden;

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

  async function loadBatchRunHistory() {
    const errEl = $('rc-batch-history-error');
    const emptyEl = $('rc-batch-history-empty');
    const wrap = $('rc-batch-history-wrap');
    if (!wrap || !emptyEl) {
      return;
    }
    if (errEl) {
      setHidden(errEl, true);
    }
    try {
      const res = await ns.adminFetch()(ns.BATCH_RUN_HISTORY_URL, {
        headers: { Accept: 'application/json' },
      });
      const body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        const msg = (body && (body.error || body.message)) || 'HTTP ' + res.status;
        if (errEl) {
          errEl.textContent = String(msg);
          setHidden(errEl, false);
        }
        setHidden(emptyEl, true);
        setHidden(wrap, true);
        return;
      }
      const entries = (body && body.entries) || [];
      if (!entries.length) {
        setHidden(emptyEl, false);
        setHidden(wrap, true);
        return;
      }
      setHidden(emptyEl, true);
      setHidden(wrap, false);
      renderBatchRunHistoryTable(entries);
    } catch (e) {
      if (errEl) {
        errEl.textContent = e instanceof Error ? e.message : 'Network error';
        setHidden(errEl, false);
      }
      setHidden(emptyEl, true);
      setHidden(wrap, true);
    }
  }

  async function loadHealthMetrics() {
    const errEl = $('rc-health-error');
    const liveEl = $('rc-health-live');
    const histWrap = $('rc-health-history-wrap');
    if (!liveEl) {
      return;
    }
    setHidden(errEl, true);
    try {
      const res = await ns.adminFetch()(ns.METRICS_URL, { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        const msg = (body && (body.error || body.message)) || 'HTTP ' + res.status;
        if (errEl) {
          errEl.textContent = String(msg);
          setHidden(errEl, false);
        }
        setHidden(liveEl, true);
        if (histWrap) {
          setHidden(histWrap, true);
        }
        return;
      }
      if (body && body.live) {
        liveEl.innerHTML = renderLiveHealthHtml(body.live);
        setHidden(liveEl, false);
      }
      if (histWrap && body && body.snapshots && body.snapshots.length) {
        setHidden(histWrap, false);
        renderHealthSnapshotsTable(body.snapshots);
      } else if (histWrap) {
        setHidden(histWrap, true);
      }
    } catch (e) {
      if (errEl) {
        errEl.textContent = e instanceof Error ? e.message : 'Network error';
        setHidden(errEl, false);
      }
      setHidden(liveEl, true);
      if (histWrap) {
        setHidden(histWrap, true);
      }
    }
  }

  ns.loadHealthMetrics = loadHealthMetrics;
  ns.loadBatchRunHistory = loadBatchRunHistory;
})(typeof window !== 'undefined' ? window : globalThis);
