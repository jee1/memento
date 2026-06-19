/**
 * Review candidates panel — list render and load (#252–#254, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  const $ = ns.$;
  const setHidden = ns.setHidden;
  const state = ns.state;

  function wireTableBody() {
    const tbody = $('rc-table') && $('rc-table').querySelector('tbody');
    if (!tbody || tbody.dataset.rcWired === '1') {
      return;
    }
    tbody.dataset.rcWired = '1';
    tbody.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('[data-candidate-select]')) {
        return;
      }
      const tr = ev.target && ev.target.closest && ev.target.closest('tr[data-memory-id]');
      if (!tr) {
        return;
      }
      ns.onRowActivate(tr);
    });
    tbody.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') {
        return;
      }
      const tr = ev.target && ev.target.closest && ev.target.closest('tr[data-memory-id]');
      if (!tr) {
        return;
      }
      ev.preventDefault();
      ns.onRowActivate(tr);
    });
  }

  function renderTable(candidates) {
    const wrap = $('rc-table-wrap');
    const table = $('rc-table');
    const tbody = table && table.querySelector('tbody');
    if (!wrap || !tbody) {
      return;
    }
    ns.clearRowSelection();
    ns.resetPreviewPanel();
    tbody.textContent = '';
    const candidateIds = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      const tr = document.createElement('tr');
      const memoryId = String(c.memory_id ?? '');
      const reasonFull = String(c.reason ?? '');
      const dueRaw = String(c.due_at ?? '');
      const candidateId = String(c.id ?? '');
      candidateIds.push(candidateId);
      tr.dataset.candidateId = candidateId;
      tr.className = 'rc-row--clickable';
      tr.setAttribute('role', 'button');
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('aria-selected', 'false');
      tr.dataset.memoryId = memoryId;
      tr.dataset.priority = String(c.priority ?? '');
      tr.dataset.reason = reasonFull;
      tr.dataset.due = dueRaw;
      tr.innerHTML =
        '<td class="rc-cell-select"><input type="checkbox" data-candidate-select="' +
        ns.escapeAttr(candidateId) +
        '" aria-label="Select candidate ' +
        ns.escapeAttr(candidateId) +
        '"></td><td>' +
        ns.escapeHtml(String(c.priority ?? '')) +
        '</td><td class="rc-cell-mono">' +
        ns.escapeHtml(memoryId) +
        '</td><td>' +
        ns.escapeHtml(String(c.status ?? '')) +
        '</td><td class="rc-cell-reason" title="' +
        ns.escapeAttr(reasonFull) +
        '">' +
        ns.escapeHtml(ns.truncateReason(reasonFull)) +
        '</td><td class="rc-cell-mono">' +
        ns.escapeHtml(ns.formatDue(dueRaw)) +
        '</td><td class="rc-cell-mono">' +
        ns.escapeHtml(String(c.id ?? '')) +
        '</td>';
      tbody.appendChild(tr);
    }
    if (ns.resetBulkSelection) {
      ns.resetBulkSelection(candidateIds);
    }
    wireTableBody();
    if (ns.wireBulkTableSelection) {
      ns.wireBulkTableSelection();
    }
    setHidden(wrap, false);
  }

  function showLoading(on) {
    setHidden($('rc-loading'), !on);
  }

  function showEmpty(on) {
    setHidden($('rc-empty'), !on);
  }

  function hideTable() {
    setHidden($('rc-table-wrap'), true);
  }

  async function fetchReviewCandidateListJson() {
    const res = await ns.adminFetch()(ns.LIST_URL, { headers: { Accept: 'application/json' } });
    const body = await res.json().catch(function () {
      return {};
    });
    return { res, body };
  }

  function applyListSuccess(body) {
    const candidates = (body && body.candidates) || [];
    const ts = body && body.timestamp;
    const line = $('rc-status-line');
    if (line && ts) {
      line.textContent = 'Last updated: ' + ts;
    }
    state.lastPendingCount = candidates.length;
    if (!candidates.length) {
      if (ns.resetBulkSelection) {
        ns.resetBulkSelection([]);
      }
      showEmpty(true);
      hideTable();
      return;
    }
    renderTable(candidates);
  }

  async function loadList() {
    ns.showError('');
    showLoading(true);
    hideTable();
    showEmpty(false);
    ns.clearStatus();
    ns.clearRowSelection();
    ns.resetPreviewPanel();

    try {
      const { res, body } = await fetchReviewCandidateListJson();
      showLoading(false);
      if (!res.ok) {
        const msg = (body && (body.error || body.message)) || 'HTTP ' + res.status;
        ns.showError(String(msg));
        return;
      }
      applyListSuccess(body);
      state.pollFailureStreak = 0;
      ns.maybeStartReviewCandidatesEventSource();
      void ns.loadHealthMetrics();
      void ns.loadBatchRunHistory();
    } catch (e) {
      showLoading(false);
      ns.showError(e instanceof Error ? e.message : 'Network error');
    }
  }

  ns.renderTable = renderTable;
  ns.showLoading = showLoading;
  ns.showEmpty = showEmpty;
  ns.hideTable = hideTable;
  ns.fetchReviewCandidateListJson = fetchReviewCandidateListJson;
  ns.applyListSuccess = applyListSuccess;
  ns.loadList = loadList;
})(typeof window !== 'undefined' ? window : globalThis);
