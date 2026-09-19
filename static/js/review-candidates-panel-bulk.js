/**
 * Review candidates panel - visible-row selection and bulk actions (#519).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  const $ = ns.$;
  const state = ns.state;
  const BULK_URLS = {
    dismiss: '/admin/memory/review-candidates/bulk-dismiss',
    expire: '/admin/memory/review-candidates/bulk-expire',
  };

  // 버튼 라벨에 대상 건수를 같이 싣는다. 0건이면 숫자를 지워 버튼이
  // "선택 무시 (0건)" 처럼 읽히지 않게 한다 (#897).
  function setButtonCount(el, selectedCount) {
    if (!el) {
      return;
    }
    el.textContent = selectedCount > 0 ? ' (' + selectedCount + '건)' : '';
  }

  function syncBulkControls() {
    const selectedCount = state.selectedCandidateIds.size;
    const count = $('rc-selected-count');
    const selectAll = $('rc-select-all');
    const dismiss = $('rc-bulk-dismiss-btn');
    const expire = $('rc-bulk-expire-btn');
    const busy = state.actionInFlight;
    const allSelected =
      state.currentCandidateIds.length > 0 &&
      state.currentCandidateIds.every(function (id) {
        return state.selectedCandidateIds.has(id);
      });

    const scope = $('rc-select-all-scope');
    const loadedCount = state.currentCandidateIds.length;
    if (count) {
      count.textContent = selectedCount + '개 선택';
    }
    if (scope) {
      scope.textContent = String(loadedCount);
    }
    setButtonCount($('rc-bulk-dismiss-count'), selectedCount);
    setButtonCount($('rc-bulk-expire-count'), selectedCount);
    if (selectAll) {
      selectAll.checked = allSelected;
      selectAll.indeterminate = selectedCount > 0 && !allSelected;
      selectAll.disabled = busy || state.currentCandidateIds.length === 0;
    }
    if (dismiss) {
      dismiss.disabled = busy || selectedCount === 0;
    }
    if (expire) {
      expire.disabled = busy || selectedCount === 0;
    }
  }

  function resetBulkSelection(candidateIds) {
    state.selectedCandidateIds.clear();
    state.currentCandidateIds = candidateIds.filter(Boolean);
    syncBulkControls();
  }

  function setAllVisibleSelected(selected) {
    state.selectedCandidateIds.clear();
    if (selected) {
      for (let i = 0; i < state.currentCandidateIds.length; i += 1) {
        state.selectedCandidateIds.add(state.currentCandidateIds[i]);
      }
    }
    const checkboxes = document.querySelectorAll('[data-candidate-select]');
    for (let i = 0; i < checkboxes.length; i += 1) {
      checkboxes[i].checked = selected;
    }
    syncBulkControls();
  }

  function wireBulkTableSelection() {
    const tbody = $('rc-table') && $('rc-table').querySelector('tbody');
    if (!tbody || tbody.dataset.rcBulkWired === '1') {
      return;
    }
    tbody.dataset.rcBulkWired = '1';
    tbody.addEventListener('change', function (ev) {
      const checkbox =
        ev.target && ev.target.closest && ev.target.closest('[data-candidate-select]');
      if (!checkbox) {
        return;
      }
      const id = String(checkbox.getAttribute('data-candidate-select') || '');
      if (checkbox.checked) {
        state.selectedCandidateIds.add(id);
      } else {
        state.selectedCandidateIds.delete(id);
      }
      syncBulkControls();
    });
  }

  async function postBulkAction(action) {
    const ids = Array.from(state.selectedCandidateIds);
    if (!ids.length || state.actionInFlight) {
      return;
    }
    const label = action === 'dismiss' ? '무시' : '만료';
    const message =
      '후보 ' +
      ids.length +
      '건을 일괄 ' +
      label +
      '합니다.\n\n' +
      '· 대상: 지금 선택한 ' +
      ids.length +
      '건 (화면에 보이는 행이 아니라 선택한 전부입니다)\n' +
      '· 원본 기억: 지워지지 않고 내용도 바뀌지 않습니다\n' +
      '· 되돌리기: 기억이 조건을 다시 만족하면 다음 배치에서 새 후보로 올라옵니다\n\n' +
      '진행할까요?';
    if (typeof global.confirm === 'function' && !global.confirm(message)) {
      return;
    }

    state.actionInFlight = true;
    const wrap = $('rc-bulk-actions');
    if (wrap) {
      wrap.setAttribute('aria-busy', 'true');
    }
    syncBulkControls();
    ns.syncReviewDismissButtons();
    ns.showError('');
    try {
      const res = await ns.adminFetch()(BULK_URLS[action], {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids }),
      });
      const body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        ns.showError(String((body && (body.error || body.message)) || 'HTTP ' + res.status));
        return;
      }
      ns.showActionToast(
        String(body.updated ?? ids.length) +
          (action === 'dismiss' ? ' candidates dismissed.' : ' candidates expired.'),
      );
      resetBulkSelection([]);
      await ns.loadList();
    } catch (e) {
      ns.showError(e instanceof Error ? e.message : '네트워크 오류');
    } finally {
      state.actionInFlight = false;
      if (wrap) {
        wrap.setAttribute('aria-busy', 'false');
      }
      syncBulkControls();
      ns.syncReviewDismissButtons();
    }
  }

  function wireBulkReviewActions() {
    const selectAll = $('rc-select-all');
    const dismiss = $('rc-bulk-dismiss-btn');
    const expire = $('rc-bulk-expire-btn');
    if (selectAll) {
      selectAll.addEventListener('change', function () {
        setAllVisibleSelected(selectAll.checked);
      });
    }
    if (dismiss) {
      dismiss.addEventListener('click', function () {
        void postBulkAction('dismiss');
      });
    }
    if (expire) {
      expire.addEventListener('click', function () {
        void postBulkAction('expire');
      });
    }
    syncBulkControls();
  }

  ns.syncBulkControls = syncBulkControls;
  ns.resetBulkSelection = resetBulkSelection;
  ns.wireBulkTableSelection = wireBulkTableSelection;
  ns.postBulkAction = postBulkAction;
  ns.wireBulkReviewActions = wireBulkReviewActions;
})(typeof window !== 'undefined' ? window : globalThis);
