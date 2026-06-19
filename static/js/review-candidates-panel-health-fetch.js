/**
 * Review candidates panel — health metrics fetch (#294, #295, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  const $ = ns.$;
  const setHidden = ns.setHidden;

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
      ns.renderBatchRunHistoryTable(entries);
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
        liveEl.innerHTML = ns.renderLiveHealthHtml(body.live);
        setHidden(liveEl, false);
      }
      if (histWrap && body && body.snapshots && body.snapshots.length) {
        setHidden(histWrap, false);
        ns.renderHealthSnapshotsTable(body.snapshots);
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
