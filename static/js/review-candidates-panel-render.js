/**
 * Review candidates panel — list render, row preview, review/dismiss actions (#252–#254).
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

  function getPreviewActionsEl() {
    return $('rc-preview-actions');
  }

  function setPreviewActionsBusy(busy) {
    const wrap = getPreviewActionsEl();
    if (wrap) {
      wrap.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
  }

  function syncReviewDismissButtons() {
    const reviewBtn = $('rc-btn-review');
    const dismissBtn = $('rc-btn-dismiss');
    const id =
      state.selectedRow && state.selectedRow.dataset.candidateId
        ? String(state.selectedRow.dataset.candidateId)
        : '';
    const detail = $('rc-preview-detail');
    const visible = detail && !detail.classList.contains('hidden');
    const enable = !!(id && visible && !state.actionInFlight);
    if (reviewBtn) {
      reviewBtn.disabled = !enable;
    }
    if (dismissBtn) {
      dismissBtn.disabled = !enable;
    }
  }

  function showActionToast(message) {
    const t = $('rc-toast');
    if (!t) {
      return;
    }
    t.textContent = message;
    t.classList.remove('hidden');
    if (state.toastHideTimer) {
      clearTimeout(state.toastHideTimer);
    }
    state.toastHideTimer = setTimeout(function () {
      t.classList.add('hidden');
      t.textContent = '';
      state.toastHideTimer = null;
    }, 4000);
  }

  function showError(msg) {
    const el = $('rc-error');
    if (el) {
      el.textContent = msg || 'Request failed';
    }
    setHidden($('rc-error'), !msg);
  }

  async function postCandidateAction(action) {
    const id =
      state.selectedRow && state.selectedRow.dataset.candidateId
        ? String(state.selectedRow.dataset.candidateId)
        : '';
    if (!id || state.actionInFlight) {
      return;
    }
    state.actionInFlight = true;
    setPreviewActionsBusy(true);
    syncReviewDismissButtons();
    showError('');
    const url = ns.reviewCandidatePostUrl(id, action);
    try {
      const res = await ns.adminFetch()(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        const msg =
          (body && (body.error || body.message)) ||
          (res.status === 409
            ? 'This candidate can no longer be updated (conflict).'
            : res.status === 404
              ? 'Review candidate not found.'
              : 'HTTP ' + res.status);
        showError(String(msg));
        return;
      }
      showActionToast(action === 'review' ? 'Marked as reviewed.' : 'Dismissed.');
      await ns.loadList();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Network error');
    } finally {
      state.actionInFlight = false;
      setPreviewActionsBusy(false);
      syncReviewDismissButtons();
    }
  }

  function clearRowSelection() {
    if (state.selectedRow) {
      state.selectedRow.classList.remove('rc-row--selected');
      state.selectedRow.setAttribute('aria-selected', 'false');
      state.selectedRow = null;
    }
  }

  function resetPreviewPanel() {
    const ph = $('rc-preview-placeholder');
    const det = $('rc-preview-detail');
    const status = $('rc-preview-memory-status');
    const content = $('rc-preview-content');
    if (ph) {
      setHidden(ph, false);
    }
    if (det) {
      setHidden(det, true);
    }
    if (status) {
      status.textContent = '';
    }
    if (content) {
      content.textContent = '';
    }
    syncReviewDismissButtons();
  }

  function setPreviewCandidateFields(priority, reason, due, memoryId) {
    const p = $('rc-preview-priority');
    const r = $('rc-preview-reason');
    const d = $('rc-preview-due');
    const m = $('rc-preview-mid');
    if (p) {
      p.textContent = String(priority ?? '');
    }
    if (r) {
      r.textContent = String(reason ?? '');
    }
    if (d) {
      d.textContent = ns.formatDue(due);
    }
    if (m) {
      m.textContent = String(memoryId ?? '');
    }
  }

  async function loadMemoryPreview(memoryId) {
    const status = $('rc-preview-memory-status');
    const content = $('rc-preview-content');
    if (status) {
      status.textContent = 'Loading memory…';
    }
    if (content) {
      content.textContent = '';
    }
    try {
      const res = await ns.adminFetch()(ns.previewUrl(memoryId), {
        headers: { Accept: 'application/json' },
      });
      const body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        const msg = (body && (body.error || body.message)) || 'HTTP ' + res.status;
        if (status) {
          status.textContent = String(msg);
        }
        return;
      }
      const mem = body && body.memory;
      const text = mem && mem.content != null ? String(mem.content) : '';
      if (status) {
        status.textContent = '';
      }
      if (content) {
        content.textContent = text;
      }
    } catch (e) {
      if (status) {
        status.textContent = e instanceof Error ? e.message : 'Network error';
      }
    }
  }

  function onRowActivate(tr) {
    if (!tr || !tr.dataset.memoryId) {
      return;
    }
    clearRowSelection();
    state.selectedRow = tr;
    tr.classList.add('rc-row--selected');
    tr.setAttribute('aria-selected', 'true');

    const ph = $('rc-preview-placeholder');
    const det = $('rc-preview-detail');
    if (ph) {
      setHidden(ph, true);
    }
    if (det) {
      setHidden(det, false);
    }
    setPreviewCandidateFields(tr.dataset.priority, tr.dataset.reason, tr.dataset.due, tr.dataset.memoryId);
    loadMemoryPreview(tr.dataset.memoryId);
    syncReviewDismissButtons();
  }

  function wireTableBody() {
    const tbody = $('rc-table') && $('rc-table').querySelector('tbody');
    if (!tbody || tbody.dataset.rcWired === '1') {
      return;
    }
    tbody.dataset.rcWired = '1';
    tbody.addEventListener('click', function (ev) {
      const tr = ev.target && ev.target.closest && ev.target.closest('tr[data-memory-id]');
      if (!tr) {
        return;
      }
      onRowActivate(tr);
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
      onRowActivate(tr);
    });
  }

  function renderTable(candidates) {
    const wrap = $('rc-table-wrap');
    const table = $('rc-table');
    const tbody = table && table.querySelector('tbody');
    if (!wrap || !tbody) {
      return;
    }
    clearRowSelection();
    resetPreviewPanel();
    tbody.textContent = '';
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      const tr = document.createElement('tr');
      const memoryId = String(c.memory_id ?? '');
      const reasonFull = String(c.reason ?? '');
      const dueRaw = String(c.due_at ?? '');
      const candidateId = String(c.id ?? '');
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
        '<td>' +
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
    wireTableBody();
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
      showEmpty(true);
      hideTable();
      return;
    }
    renderTable(candidates);
  }

  async function loadList() {
    showError('');
    showLoading(true);
    hideTable();
    showEmpty(false);
    ns.clearStatus();
    clearRowSelection();
    resetPreviewPanel();

    try {
      const { res, body } = await fetchReviewCandidateListJson();
      showLoading(false);
      if (!res.ok) {
        const msg = (body && (body.error || body.message)) || 'HTTP ' + res.status;
        showError(String(msg));
        return;
      }
      applyListSuccess(body);
      state.pollFailureStreak = 0;
      ns.maybeStartReviewCandidatesEventSource();
      void ns.loadHealthMetrics();
      void ns.loadBatchRunHistory();
    } catch (e) {
      showLoading(false);
      showError(e instanceof Error ? e.message : 'Network error');
    }
  }

  ns.getPreviewActionsEl = getPreviewActionsEl;
  ns.setPreviewActionsBusy = setPreviewActionsBusy;
  ns.syncReviewDismissButtons = syncReviewDismissButtons;
  ns.showActionToast = showActionToast;
  ns.showError = showError;
  ns.postCandidateAction = postCandidateAction;
  ns.clearRowSelection = clearRowSelection;
  ns.resetPreviewPanel = resetPreviewPanel;
  ns.renderTable = renderTable;
  ns.showLoading = showLoading;
  ns.showEmpty = showEmpty;
  ns.hideTable = hideTable;
  ns.fetchReviewCandidateListJson = fetchReviewCandidateListJson;
  ns.applyListSuccess = applyListSuccess;
  ns.loadList = loadList;
})(typeof window !== 'undefined' ? window : globalThis);
