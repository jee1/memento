/**
 * Review candidates panel (#252) — pending list via mementoAdminFetch
 */
(function (global) {
  'use strict';

  const LIST_URL = '/admin/memory/review-candidates?status=pending';
  const REASON_MAX = 120;

  let wired = false;
  let loadedOnce = false;

  function $(id) {
    return document.getElementById(id);
  }

  function setHidden(el, hidden) {
    if (!el) {
      return;
    }
    el.classList.toggle('hidden', hidden);
  }

  function clearStatus() {
    const line = $('rc-status-line');
    if (line) {
      line.textContent = '';
    }
  }

  function truncateReason(text) {
    if (!text) {
      return '';
    }
    if (text.length <= REASON_MAX) {
      return text;
    }
    return text.slice(0, REASON_MAX) + '…';
  }

  function renderTable(candidates) {
    const wrap = $('rc-table-wrap');
    const table = $('rc-table');
    const tbody = table && table.querySelector('tbody');
    if (!wrap || !tbody) {
      return;
    }
    tbody.textContent = '';
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(String(c.priority ?? '')) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(String(c.memory_id ?? '')) +
        '</td><td>' +
        escapeHtml(String(c.status ?? '')) +
        '</td><td class="rc-cell-reason">' +
        escapeHtml(truncateReason(String(c.reason ?? ''))) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(String(c.due_at ?? '')) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(String(c.id ?? '')) +
        '</td>';
      tbody.appendChild(tr);
    }
    setHidden(wrap, false);
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showLoading(on) {
    setHidden($('rc-loading'), !on);
  }

  function showError(msg) {
    const el = $('rc-error');
    if (el) {
      el.textContent = msg || 'Request failed';
    }
    setHidden($('rc-error'), !msg);
  }

  function showEmpty(on) {
    setHidden($('rc-empty'), !on);
  }

  function hideTable() {
    setHidden($('rc-table-wrap'), true);
  }

  async function loadList() {
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    showError('');
    showLoading(true);
    hideTable();
    showEmpty(false);
    clearStatus();

    try {
      const res = await fetchFn(LIST_URL, { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(function () {
        return {};
      });
      showLoading(false);
      if (!res.ok) {
        const msg =
          (body && (body.error || body.message)) ||
          'HTTP ' + res.status;
        showError(String(msg));
        return;
      }
      const candidates = (body && body.candidates) || [];
      const ts = body && body.timestamp;
      const line = $('rc-status-line');
      if (line && ts) {
        line.textContent = 'Last updated: ' + ts;
      }
      if (!candidates.length) {
        showEmpty(true);
        return;
      }
      renderTable(candidates);
    } catch (e) {
      showLoading(false);
      showError(e instanceof Error ? e.message : 'Network error');
    }
  }

  function initReviewCandidatesPanel() {
    if (!wired) {
      wired = true;
      const btn = $('rc-refresh-btn');
      if (btn) {
        btn.addEventListener('click', function () {
          loadedOnce = true;
          loadList();
        });
      }
    }
    if (!loadedOnce) {
      loadedOnce = true;
      loadList();
    }
  }

  global.initReviewCandidatesPanel = initReviewCandidatesPanel;
})(typeof window !== 'undefined' ? window : globalThis);
