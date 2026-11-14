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

  function isVerdictApplicable(verdict) {
    return verdict === 'confirmed' || verdict === 'pending';
  }

  function restoreExpectedNewId(row) {
    return row.old_superseded_by != null && row.old_superseded_by !== '' ? row.old_superseded_by : row.new_memory_id;
  }

  function setApplyRestoreDismissState(row, wrap) {
    const applyBlocked = !row.supersede_apply_enabled;
    const verdictOk = isVerdictApplicable(row.verdict);
    const oldS = row.old_superseded_by;
    const supersededElsewhere =
      row.lifecycle_status === 'not_applied' &&
      oldS != null &&
      oldS !== '' &&
      oldS !== row.new_memory_id;
    const hint = wrap.querySelector('.sc-apply-hint');
    hint.textContent = '';
    hint.classList.add('hidden');
    if (applyBlocked) {
      hint.textContent = S.applyDisabled;
      hint.classList.remove('hidden');
    } else if (!verdictOk) {
      hint.textContent = S.verdictNotApplicable;
      hint.classList.remove('hidden');
    } else if (supersededElsewhere) {
      hint.textContent = S.alreadySupersededBlocked;
      hint.classList.remove('hidden');
    } else if (row.lifecycle_status === 'dangling_pointer') {
      hint.textContent = S.danglingPointerRestoreFirst;
      hint.classList.remove('hidden');
    } else if (row.lifecycle_status === 'target_deleted') {
      hint.textContent = S.targetDeletedApplyHint;
      hint.classList.remove('hidden');
    }
    const applyBtn = wrap.querySelector('.sc-btn-apply');
    applyBtn.disabled =
      applyBlocked ||
      row.lifecycle_status === 'dismissed' ||
      row.lifecycle_status === 'applied' ||
      row.lifecycle_status === 'target_deleted' ||
      row.lifecycle_status === 'dangling_pointer' ||
      supersededElsewhere ||
      !verdictOk;
    const restoreBtn = wrap.querySelector('.sc-btn-restore');
    const restoreAllowed =
      row.lifecycle_status === 'applied' ||
      row.lifecycle_status === 'target_deleted' ||
      row.lifecycle_status === 'dangling_pointer';
    restoreBtn.disabled = applyBlocked || !restoreAllowed;
    wrap.querySelector('.sc-btn-dismiss').disabled =
      row.lifecycle_status === 'dismissed' ||
      row.lifecycle_status === 'applied' ||
      row.lifecycle_status === 'target_deleted';
  }

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
    const wrap = document.createElement('div');
    wrap.className = 'sc-detail-grid';
    wrap.innerHTML =
      '<div class="sc-detail-col"><h3 class="m-panel__subtitle">옛 기억</h3><p class="sc-memory-id"></p><pre class="sc-preview"></pre></div>' +
      '<div class="sc-detail-col"><h3 class="m-panel__subtitle">새 기억</h3><p class="sc-memory-id"></p><pre class="sc-preview"></pre></div>' +
      '<div class="sc-detail-meta"><p class="sc-rationale"></p><p class="sc-evidence-quote"></p><p class="sc-judge"></p></div>' +
      '<p class="sc-content-status" role="status"></p>' +
      '<p class="sc-apply-hint hidden"></p>' +
      '<div class="sc-detail-actions">' +
      '<button type="button" class="m-button sc-btn-apply">승인</button>' +
      '<button type="button" class="m-button m-button--secondary sc-btn-restore">되돌리기</button>' +
      '<button type="button" class="m-button m-button--secondary sc-btn-dismiss">거절</button>' +
      '</div>';
    const cols = wrap.querySelectorAll('.sc-detail-col');
    cols[0].querySelector('.sc-memory-id').textContent = row.old_memory_id;
    cols[1].querySelector('.sc-memory-id').textContent = row.new_memory_id;
    wrap.querySelector('.sc-rationale').textContent = row.rationale;
    const quote = row.evidence_quote == null ? '' : String(row.evidence_quote);
    wrap.querySelector('.sc-evidence-quote').textContent =
      quote.trim() === '' ? S.evidenceQuoteMissing : quote;
    wrap.querySelector('.sc-judge').textContent =
      row.provider + ' / ' + row.model + ' · ' + row.judged_at + ' · ' + (S.lifecycleLabel[row.lifecycle_status] || row.lifecycle_status);
    setApplyRestoreDismissState(row, wrap);
    const applyBtn = wrap.querySelector('.sc-btn-apply');
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
    void loadDetailContents(row, wrap);
  }

  async function loadDetailContents(row, wrap) {
    const applyBtn = wrap.querySelector('.sc-btn-apply');
    const status = wrap.querySelector('.sc-content-status');
    applyBtn.disabled = true;
    status.textContent = '전체 본문을 불러오는 중…';
    try {
      const contents = await Promise.all([row.old_memory_id, row.new_memory_id].map(async function (id) {
        const response = await ns.apiFetch('/admin/memory/items/' + encodeURIComponent(id));
        if (!response.ok) {
          throw new Error('Memory body request failed');
        }
        const data = await response.json();
        if (!data.memory || typeof data.memory.content !== 'string') {
          throw new Error('Memory body is missing');
        }
        return data.memory.content;
      }));
      const bodies = wrap.querySelectorAll('.sc-preview');
      contents.forEach(function (content, index) {
        bodies[index].textContent = content;
      });
      status.textContent = '';
      setApplyRestoreDismissState(row, wrap);
    } catch {
      status.textContent = '전체 본문을 불러오지 못해 승인할 수 없습니다. 기억이 삭제되었거나 조회에 실패했습니다. 새로고침 후 다시 확인하세요.';
    }
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
      tdVerdict.textContent = S.verdictLabel[row.verdict] || row.verdict;
      const tdProject = document.createElement('td');
      tdProject.textContent = row.project_id || '—';
      const tdOld = document.createElement('td');
      tdOld.className = 'sc-cell-preview';
      tdOld.textContent = row.old_content_preview;
      if (row.old_content_preview) {
        tdOld.title = row.old_content_preview;
      }
      const tdNew = document.createElement('td');
      tdNew.className = 'sc-cell-preview';
      tdNew.textContent = row.new_content_preview;
      if (row.new_content_preview) {
        tdNew.title = row.new_content_preview;
      }
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
            expected_new_memory_id: restoreExpectedNewId(row),
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
    const section = ns.$('rc-supersede-section');
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
      if (section) {
        section.addEventListener('toggle', function () {
          if (section.open) {
            void loadList();
          }
        });
      }
    }
    if (section && section.open) {
      void loadList();
    }
  }

  global.initSupersedeCandidatesPanel = initSupersedeCandidatesPanel;
})(typeof window !== 'undefined' ? window : globalThis);
