/**
 * Ops status strip (#1025) — one-line summary under the tab bar.
 * Reads the same GET /admin/status the 상태 tab uses; no new endpoint,
 * no polling. A fetch failure degrades to muted dashes, never a banner.
 */
(function (global) {
  'use strict';

  const STATUS_URL = '/admin/status';
  const LS_COLLAPSED = 'memento_ops_strip_collapsed_v1';
  const EMPTY = '—';

  function $(id) {
    return global.document.getElementById(id);
  }

  function readCollapsed() {
    try {
      return global.localStorage && global.localStorage.getItem(LS_COLLAPSED) === '1';
    } catch (err) {
      return false;
    }
  }

  function writeCollapsed(collapsed) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(LS_COLLAPSED, collapsed ? '1' : '0');
      }
    } catch (err) {
      /* per-viewer convenience only; ignore quota or privacy-mode failures */
    }
  }

  function setDot(id, status) {
    const el = $(id);
    if (!el) return;
    el.className = 'ops-strip__dot ops-strip__dot--' + (status === 'ok' || status === 'degraded' ? status : 'unavailable');
  }

  function setValue(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function clearValues() {
    setValue('ops-strip-embedding', EMPTY);
    setValue('ops-strip-review', EMPTY);
    setValue('ops-strip-failed', EMPTY);
    setValue('ops-strip-now', EMPTY);
    setDot('ops-strip-embedding-dot', 'unavailable');
    setDot('ops-strip-review-dot', 'unavailable');
    setDot('ops-strip-failed-dot', 'unavailable');
    setDot('ops-strip-now-dot', 'unavailable');
  }

  function formatClock(timestamp) {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return EMPTY;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  function render(data) {
    setValue('ops-strip-embedding', String(data.embedding.problemCount) + '건');
    setDot('ops-strip-embedding-dot', data.embedding.status);
    setValue('ops-strip-review', String(data.review.pendingTotal) + '건');
    setDot('ops-strip-review-dot', data.review.status);
    setValue('ops-strip-failed', String(data.batchImpact.failedRunCount) + '건');
    setDot('ops-strip-failed-dot', data.batchImpact.status);
    setValue('ops-strip-now', formatClock(data.timestamp));
    setDot('ops-strip-now-dot', data.process.status);
  }

  function isShaped(data) {
    return !!(data && data.embedding && data.review && data.batchImpact && data.process);
  }

  async function load() {
    try {
      const response = await global.fetch(STATUS_URL, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      if (!response.ok) {
        clearValues();
        return;
      }
      const data = await response.json();
      if (!isShaped(data)) {
        clearValues();
        return;
      }
      render(data);
    } catch (err) {
      clearValues();
    }
  }

  function applyCollapsed(collapsed) {
    const metrics = $('ops-strip-metrics');
    const toggle = $('ops-strip-toggle');
    if (metrics) metrics.hidden = collapsed;
    if (toggle) {
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.textContent = collapsed ? '운영 상태 펼치기' : '접기';
    }
  }

  function init() {
    const toggle = $('ops-strip-toggle');
    if (!toggle) return;
    applyCollapsed(readCollapsed());
    toggle.addEventListener('click', function () {
      const next = toggle.getAttribute('aria-expanded') === 'true';
      applyCollapsed(next);
      writeCollapsed(next);
    });
    load();
  }

  global.__MEMENTO_OPS_STRIP__ = { load: load, init: init };

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
