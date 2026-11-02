/**
 * Supersede candidates admin panel (#1618).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_SUPERSEDE_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  const state = ns.state;
  const S = ns.S;

  function selectedCandidate() {
    return state.candidates.find(function (c) {
      return c.id === state.selectedId;
    });
  }

  function setStatus(text) {
    const line = ns.$('sc-status-line');
    if (line) {
      line.textContent = text || '';
    }
  }

  function renderDetail(row) {
    const detail = ns.$('sc-detail');
    if (!detail) {
      return;
    }
    ns.clearNode = ns.clearNode || function (el) {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    };
    ns.clearNode(detail);
    if (!row) {
      detail.textContent = S.selectRow;
      return;
    }
    const applyBlocked = !row.supersede_apply_enabled;
    const wrap = document.createElement('div');
    wrap.className = 'sc-detail-grid';
    wrap.innerHTML =
      '<div class="sc-detail-col"><h3 class="m-panel__subtitle">옛 기억</h3><p class="sc-memory-id"></p><pre class="sc-preview"></pre></div>' +
      '<div class="sc-detail-col"><h3 class="m-panel__subtitle">새 기억</h3><p class="sc-memory-id"></p><pre class="sc-preview"></pre></div>' +
      '<div class="sc-detail-meta"><p class="sc-rationale"></p><p class="sc-judge"></p></div>' +
      '<p class="sc-apply-hint hidden"></p>' +
      '<div class="sc-detail-actions">' +
      '<button type="button" class="m-button sc-btn-apply">승인(apply)</button>' +
      '<button type="button" class="m-button m-button--secondary sc-btn-restore">되돌리기(restore)</button>' +
      '<button type="button" class="m-button m-button--secondary sc-btn-dismiss">거절</button>' +
      '</div>';
    const cols = wrap.querySelectorAll('.sc-detail-col');
    cols[0].querySelector('.sc-memory-id').textContent = row.old_memory_id;
    cols[0].querySelector('.sc-preview').textContent = row.old_content_preview;
    cols[1].querySelector('.sc-memory-id').textContent = row.new_memory_id;
    cols[1].querySelector('.sc-preview').textContent = row.new_content_preview;
    wrap.querySelector('.sc-rationale').textContent = row.rationale;
    wrap.querySelector('.sc-judge').textContent =
      row.provider + ' / ' + row.model + ' · ' + row.judged_at + ' · ' + (S.lifecycleLabel[row.lifecycle_status] || row.lifecycle_status);
    const hint = wrap.querySelector('.sc-apply-hint');
    if (applyBlocked) {
      hint.textContent = S.applyDisabled;
      hint.classList.remove('hidden');
    }
    const applyBtn = wrap.querySelector('.sc-btn-apply');
    applyBtn.disabled = applyBlocked || row.lifecycle_status === 'dismissed' || row.lifecycle_status === 'applied';
    const restoreBtn = wrap.querySelector('.sc-btn-restore');
    restoreBtn.disabled = applyBlocked || row.lifecycle_status !== 'applied';
    wrap.querySelector('.sc-btn-dismiss').disabled =
      row.lifecycle_status === 'dismissed' || row.lifecycle_status === 'applied';
    applyBtn.addEventListener('click', function () {
      void postAction('apply', row.id);
    });
    wrap.querySelector('.sc-btn-restore').addEventListener('click', function () {
      void postRestore(row);
    });
    wrap.querySelector('.sc-btn-dismiss').addEventListener('click', function () {
      const reason = window.prompt('거절 사유를 입력하세요:');
      if (reason === null) {
        return;
      }
      if (!reason.trim()) {
        setStatus('사유를 입력하세요.');
        return;
      }
      void postAction('dismiss', row.id, reason.trim());
    });
    detail.appendChild(wrap);
  }

  function renderList() {
    const tbody = ns.$('sc-table-body');
    if (!tbody) {
      return;
    }
    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }
    state.candidates.forEach(function (row) {
      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      if (row.id === state.selectedId) {
        tr.classList.add('sc-row-selected');
      }
      const tdStatus = document.createElement('td');
      tdStatus.textContent = S.lifecycleLabel[row.lifecycle_status] || row.lifecycle_status;
      const tdVerdict = document.createElement('td');
      tdVerdict.textContent = row.verdict;
      const tdProject = document.createElement('td');
      tdProject.textContent = row.project_id || '—';
      const tdOld = document.createElement('td');
      tdOld.className = 'sc-cell-preview';
      tdOld.textContent = row.old_content_preview;
      const tdNew = document.createElement('td');
      tdNew.className = 'sc-cell-preview';
      tdNew.textContent = row.new_content_preview;
      tr.appendChild(tdStatus);
      tr.appendChild(tdVerdict);
      tr.appendChild(tdProject);
      tr.appendChild(tdOld);
      tr.appendChild(tdNew);
      tr.addEventListener('click', function () {
        state.selectedId = row.id;
        renderList();
        renderDetail(row);
      });
      tbody.appendChild(tr);
    });
    if (!state.candidates.length) {
      setStatus(S.empty);
    } else if (state.pagination) {
      setStatus('총 ' + state.pagination.total_count + '건');
    }
    if (!selectedCandidate() && state.candidates[0]) {
      state.selectedId = state.candidates[0].id;
      renderDetail(state.candidates[0]);
    } else {
      renderDetail(selectedCandidate());
    }
  }

  async function postAction(action, id, reason) {
    if (state.inFlight) {
      return;
    }
    state.inFlight = true;
    try {
      const response = await ns.apiFetch('/admin/memory/supersede-candidates/' + encodeURIComponent(id) + '/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'dashboard' }),
      });
      const data = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        setStatus(S.actionFailed(data.code || String(response.status)));
        return;
      }
      await loadList();
    } finally {
      state.inFlight = false;
    }
  }

  async function postRestore(row) {
    if (state.inFlight) {
      return;
    }
    state.inFlight = true;
    try {
      const response = await ns.apiFetch(
        '/admin/memory/items/' + encodeURIComponent(row.old_memory_id) + '/supersede/restore',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expected_new_memory_id: row.new_memory_id,
            reason: 'dashboard',
          }),
        },
      );
      const data = await response.json().catch(function () {
        return {};
      });
      if (!response.ok) {
        setStatus(S.actionFailed(data.code || String(response.status)));
        return;
      }
      await loadList();
    } finally {
      state.inFlight = false;
    }
  }

  async function loadList() {
    setStatus('불러오는 중…');
    const response = await ns.apiFetch(ns.buildListUrl());
    if (!response.ok) {
      setStatus(S.loadFailed);
      return;
    }
    const data = await response.json();
    state.candidates = data.candidates || [];
    state.pagination = data.pagination || null;
    renderList();
  }

  function initSupersedeCandidatesPanel() {
    if (!state.wired) {
      state.wired = true;
      const refresh = ns.$('sc-refresh-btn');
      if (refresh) {
        refresh.addEventListener('click', function () {
          void loadList();
        });
      }
      const applyFilter = ns.$('sc-filter-apply');
      if (applyFilter) {
        applyFilter.addEventListener('click', function () {
          void loadList();
        });
      }
    }
    state.loadedOnce = true;
    void loadList();
  }

  global.initSupersedeCandidatesPanel = initSupersedeCandidatesPanel;
})(typeof window !== 'undefined' ? window : globalThis);
