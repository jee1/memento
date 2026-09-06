/**
 * Review candidates panel — preview UI helpers (#252–#254, #546).
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

  function clearRowSelection() {
    if (state.selectedRow) {
      state.selectedRow.classList.remove('rc-row--selected');
      state.selectedRow.setAttribute('aria-selected', 'false');
      state.selectedRow = null;
    }
    state.previewMemoryId = '';
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
    const candidateId =
      state.selectedRow && state.selectedRow.dataset.candidateId
        ? String(state.selectedRow.dataset.candidateId)
        : '';
    const generation = ++state.previewGeneration;
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
      if (
        generation !== state.previewGeneration ||
        !state.selectedRow ||
        state.selectedRow.dataset.candidateId !== candidateId
      ) {
        return;
      }
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
      if (
        generation !== state.previewGeneration ||
        !state.selectedRow ||
        state.selectedRow.dataset.candidateId !== candidateId
      ) {
        return;
      }
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
    state.previewMemoryId = tr.dataset.memoryId;
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

  ns.getPreviewActionsEl = getPreviewActionsEl;
  ns.setPreviewActionsBusy = setPreviewActionsBusy;
  ns.syncReviewDismissButtons = syncReviewDismissButtons;
  ns.clearRowSelection = clearRowSelection;
  ns.resetPreviewPanel = resetPreviewPanel;
  ns.onRowActivate = onRowActivate;
})(typeof window !== 'undefined' ? window : globalThis);
