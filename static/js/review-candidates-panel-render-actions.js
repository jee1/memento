/**
 * Review candidates panel — review/dismiss actions (#252–#254, #546).
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
    ns.setPreviewActionsBusy(true);
    ns.syncReviewDismissButtons();
    if (ns.syncBulkControls) {
      ns.syncBulkControls();
    }
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
      ns.setPreviewActionsBusy(false);
      ns.syncReviewDismissButtons();
      if (ns.syncBulkControls) {
        ns.syncBulkControls();
      }
    }
  }

  ns.showActionToast = showActionToast;
  ns.showError = showError;
  ns.postCandidateAction = postCandidateAction;
})(typeof window !== 'undefined' ? window : globalThis);
