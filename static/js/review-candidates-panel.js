/**
 * Review candidates panel (#252 list, #253 row preview + memory body)
 */
(function (global) {
  'use strict';

  const LIST_URL = '/admin/memory/review-candidates?status=pending';
  const REASON_TABLE_MAX = 120;

  let wired = false;
  let loadedOnce = false;
  let selectedRow = null;

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

  async function loadList() {
    const fetchFn = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    showError('');
    showLoading(true);
    hideTable();
    showEmpty(false);
    clearStatus();
    clearRowSelection();
    resetPreviewPanel();

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
