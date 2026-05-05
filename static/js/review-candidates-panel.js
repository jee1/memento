/**
 * Review candidates panel (#252 list, #253 row preview + memory body, #255 poll notify, #274 configurable poll, #276 SSE + poll fallback)
 */
(function (global) {
  'use strict';

  const LIST_URL = '/admin/memory/review-candidates?status=pending';
  const STREAM_URL = '/admin/memory/review-candidates/stream';
  const REASON_TABLE_MAX = 120;

  let wired = false;
  let loadedOnce = false;
  let selectedRow = null;
  let pollTimer = null;
  let visListenerRegistered = false;
  let lastPendingCount = -1;
  let toastHideTimer = null;
  let actionInFlight = false;
  let pollFailureStreak = 0;
  let reviewSse = null;

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
    if (text.length <= REASON_TABLE_MAX) {
      return text;
    }
    return text.slice(0, REASON_TABLE_MAX) + '…';
  }

  function formatDue(iso) {
    if (!iso) {
      return '';
    }
    const d = new Date(String(iso));
    if (Number.isNaN(d.getTime())) {
      return String(iso);
    }
    return d.toLocaleString();
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function previewUrl(memoryId) {
    return '/admin/memory/items/' + encodeURIComponent(memoryId);
  }

  function reviewCandidatePostUrl(id, action) {
    return '/admin/memory/review-candidates/' + encodeURIComponent(id) + '/' + action;
  }

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
    const id = selectedRow && selectedRow.dataset.candidateId ? String(selectedRow.dataset.candidateId) : '';
    const detail = $('rc-preview-detail');
    const visible = detail && !detail.classList.contains('hidden');
    const enable = !!(id && visible && !actionInFlight);
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
    if (toastHideTimer) {
      clearTimeout(toastHideTimer);
    }
    toastHideTimer = setTimeout(function () {
      t.classList.add('hidden');
      t.textContent = '';
      toastHideTimer = null;
    }, 4000);
  }

  async function postCandidateAction(action) {
    const id = selectedRow && selectedRow.dataset.candidateId ? String(selectedRow.dataset.candidateId) : '';
    if (!id || actionInFlight) {
      return;
    }
    actionInFlight = true;
    setPreviewActionsBusy(true);
    syncReviewDismissButtons();
    showError('');
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    const url = reviewCandidatePostUrl(id, action);
    try {
      const res = await fetchFn(url, {
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
      await loadList();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Network error');
    } finally {
      actionInFlight = false;
      setPreviewActionsBusy(false);
      syncReviewDismissButtons();
    }
  }

  function clearRowSelection() {
    if (selectedRow) {
      selectedRow.classList.remove('rc-row--selected');
      selectedRow.setAttribute('aria-selected', 'false');
      selectedRow = null;
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
      d.textContent = formatDue(due);
    }
    if (m) {
      m.textContent = String(memoryId ?? '');
    }
  }

  async function loadMemoryPreview(memoryId) {
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    const status = $('rc-preview-memory-status');
    const content = $('rc-preview-content');
    if (status) {
      status.textContent = 'Loading memory…';
    }
    if (content) {
      content.textContent = '';
    }
    try {
      const res = await fetchFn(previewUrl(memoryId), { headers: { Accept: 'application/json' } });
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
    selectedRow = tr;
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
        escapeHtml(String(c.priority ?? '')) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(memoryId) +
        '</td><td>' +
        escapeHtml(String(c.status ?? '')) +
        '</td><td class="rc-cell-reason" title="' +
        escapeAttr(reasonFull) +
        '">' +
        escapeHtml(truncateReason(reasonFull)) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(formatDue(dueRaw)) +
        '</td><td class="rc-cell-mono">' +
        escapeHtml(String(c.id ?? '')) +
        '</td>';
      tbody.appendChild(tr);
    }
    wireTableBody();
    setHidden(wrap, false);
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

  function clearReviewTabBadge() {
    const b = $('rc-tab-badge');
    if (b) {
      b.textContent = '';
      b.classList.add('hidden');
      b.setAttribute('aria-hidden', 'true');
    }
  }

  function setReviewTabBadge(totalPending) {
    const b = $('rc-tab-badge');
    if (!b || !(totalPending > 0)) {
      return;
    }
    b.textContent = totalPending > 99 ? '99+' : String(totalPending);
    b.classList.remove('hidden');
    b.setAttribute('aria-hidden', 'false');
  }

  function showNewCandidatesToast(delta, onReviewTab) {
    const t = $('rc-toast');
    if (!t) {
      return;
    }
    const msg =
      delta === 1
        ? '1 new review candidate (pending queue grew).'
        : String(delta) + ' new review candidates (pending queue grew).';
    t.textContent =
      msg + (onReviewTab ? ' List updated.' : ' Open Review Queue to refresh.');
    t.classList.remove('hidden');
    if (toastHideTimer) {
      clearTimeout(toastHideTimer);
    }
    toastHideTimer = setTimeout(function () {
      t.classList.add('hidden');
      t.textContent = '';
      toastHideTimer = null;
    }, 8000);
  }

  function getReviewQueueBoot() {
    const b = global.__MEMENTO_REVIEW_QUEUE__;
    const fallbackPoll = 60 * 1000;
    const pollRaw = b && Number(b.pollIntervalMs);
    const pollIntervalMs =
      Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : fallbackPoll;
    const backoffRaw = b && b.pollErrorBackoffMs;
    const pollErrorBackoffMs = Array.isArray(backoffRaw)
      ? backoffRaw
          .map(function (x) {
            return Number(x);
          })
          .filter(function (n) {
            return Number.isFinite(n) && n > 0;
          })
      : [];
    return { pollIntervalMs: pollIntervalMs, pollErrorBackoffMs: pollErrorBackoffMs };
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  function schedulePollAfterMs(delayMs) {
    clearPollTimer();
    const boot = getReviewQueueBoot();
    const d = Number(delayMs);
    const safe = Number.isFinite(d) && d > 0 ? d : boot.pollIntervalMs;
    pollTimer = setTimeout(function () {
      pollTimer = null;
      void runPollCycle();
    }, safe);
  }

  /** While EventSource is connected, skip poll timers (#276). */
  function schedulePollAfterMsUnlessSse(delayMs) {
    if (typeof EventSource !== 'undefined' && reviewSse && reviewSse.readyState === EventSource.OPEN) {
      return;
    }
    schedulePollAfterMs(delayMs);
  }

  function registerVisibilityForPoll() {
    if (visListenerRegistered) {
      return;
    }
    visListenerRegistered = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        void runPollCycle();
      }
    });
  }

  function startPollingIfNeeded() {
    if (pollTimer !== null) {
      return;
    }
    registerVisibilityForPoll();
    schedulePollAfterMs(getReviewQueueBoot().pollIntervalMs);
  }

  function stopReviewCandidatesStream() {
    if (reviewSse) {
      reviewSse.close();
      reviewSse = null;
    }
  }

  function resumePollingAfterStreamLoss() {
    stopReviewCandidatesStream();
    startPollingIfNeeded();
  }

  async function onReviewQueueSseChanged() {
    let res;
    let body;
    try {
      const r = await fetchReviewCandidateListJson();
      res = r.res;
      body = r.body;
    } catch {
      resumePollingAfterStreamLoss();
      return;
    }
    if (!res.ok) {
      resumePollingAfterStreamLoss();
      return;
    }
    pollFailureStreak = 0;
    const reviewPanel = $('tab-review-candidates');
    const onReview = !!(reviewPanel && reviewPanel.classList.contains('active'));
    if (onReview) {
      applyListSuccess(body);
      return;
    }
    const candidates = (body && body.candidates) || [];
    const n = candidates.length;
    const prev = lastPendingCount;
    if (prev >= 0 && n > prev) {
      showNewCandidatesToast(n - prev, false);
      setReviewTabBadge(n);
    }
    lastPendingCount = n;
  }

  function maybeStartReviewCandidatesEventSource() {
    if (typeof EventSource === 'undefined') {
      startPollingIfNeeded();
      return;
    }
    if (reviewSse) {
      return;
    }
    try {
      reviewSse = new EventSource(STREAM_URL);
    } catch {
      reviewSse = null;
      startPollingIfNeeded();
      return;
    }
    reviewSse.addEventListener('open', function () {
      clearPollTimer();
      pollFailureStreak = 0;
    });
    reviewSse.addEventListener('changed', function () {
      void onReviewQueueSseChanged();
    });
    reviewSse.onerror = function () {
      resumePollingAfterStreamLoss();
    };
  }

  async function fetchReviewCandidateListJson() {
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    const res = await fetchFn(LIST_URL, { headers: { Accept: 'application/json' } });
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
    lastPendingCount = candidates.length;
    if (!candidates.length) {
      showEmpty(true);
      hideTable();
      return;
    }
    renderTable(candidates);
  }

  function scheduleAfterPollFailure(boot) {
    pollFailureStreak += 1;
    let delayMs = boot.pollIntervalMs;
    const steps = boot.pollErrorBackoffMs;
    if (steps.length > 0) {
      const idx = Math.min(pollFailureStreak - 1, steps.length - 1);
      delayMs = steps[idx];
    }
    schedulePollAfterMs(delayMs);
  }

  async function runPollCycle() {
    const boot = getReviewQueueBoot();
    if (document.visibilityState === 'hidden') {
      schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
      return;
    }
    if (lastPendingCount < 0) {
      schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
      return;
    }
    let res;
    let body;
    try {
      const r = await fetchReviewCandidateListJson();
      res = r.res;
      body = r.body;
    } catch {
      scheduleAfterPollFailure(boot);
      return;
    }
    if (!res.ok) {
      scheduleAfterPollFailure(boot);
      return;
    }
    pollFailureStreak = 0;
    const candidates = (body && body.candidates) || [];
    const n = candidates.length;
    const prev = lastPendingCount;
    if (prev >= 0 && n > prev) {
      const delta = n - prev;
      const reviewPanel = $('tab-review-candidates');
      const onReview = !!(reviewPanel && reviewPanel.classList.contains('active'));
      showNewCandidatesToast(delta, onReview);
      if (!onReview) {
        setReviewTabBadge(n);
      }
      if (onReview) {
        applyListSuccess(body);
        schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
        return;
      }
      lastPendingCount = n;
      schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
      return;
    }
    lastPendingCount = n;
    schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
  }

  async function loadList() {
    showError('');
    showLoading(true);
    hideTable();
    showEmpty(false);
    clearStatus();
    clearRowSelection();
    resetPreviewPanel();

    try {
      const { res, body } = await fetchReviewCandidateListJson();
      showLoading(false);
      if (!res.ok) {
        const msg =
          (body && (body.error || body.message)) ||
          'HTTP ' + res.status;
        showError(String(msg));
        return;
      }
      applyListSuccess(body);
      pollFailureStreak = 0;
      maybeStartReviewCandidatesEventSource();
    } catch (e) {
      showLoading(false);
      showError(e instanceof Error ? e.message : 'Network error');
    }
  }

  function initReviewCandidatesPanel() {
    clearReviewTabBadge();
    if (!wired) {
      wired = true;
      global.addEventListener('beforeunload', function () {
        stopReviewCandidatesStream();
      });
      const btn = $('rc-refresh-btn');
      if (btn) {
        btn.addEventListener('click', function () {
          loadedOnce = true;
          loadList();
        });
      }
      const btnReview = $('rc-btn-review');
      if (btnReview) {
        btnReview.addEventListener('click', function () {
          void postCandidateAction('review');
        });
      }
      const btnDismiss = $('rc-btn-dismiss');
      if (btnDismiss) {
        btnDismiss.addEventListener('click', function () {
          void postCandidateAction('dismiss');
        });
      }
    }
    if (!loadedOnce) {
      loadedOnce = true;
    }
    loadList();
  }

  global.initReviewCandidatesPanel = initReviewCandidatesPanel;
})(typeof window !== 'undefined' ? window : globalThis);
