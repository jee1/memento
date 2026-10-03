/**
 * Memory finder panel (#1118) — open one memory by Memory ID.
 * Reuses GET /admin/memory/items/:memory_id (same preview payload as the review queue).
 * The server validates the id (400) and existence (404); the client only rejects an empty input.
 */
(function (global) {
  'use strict';

  const state = { bound: false, deepLinkConsumed: false, generation: 0 };

  function $(id) {
    return global.document.getElementById(id);
  }

  function setHidden(el, hidden) {
    if (el) {
      el.classList.toggle('hidden', hidden);
    }
  }

  function setStatus(message) {
    const el = $('mf-status');
    if (el) {
      el.textContent = message;
    }
  }

  function setField(id, value) {
    const el = $(id);
    if (el) {
      el.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
    }
  }

  function itemUrl(memoryId) {
    return '/admin/memory/items/' + encodeURIComponent(memoryId);
  }

  function statusMessage(status, body) {
    if (status === 400) {
      return '올바른 Memory ID 형식이 아닙니다 (mem_…)';
    }
    if (status === 404) {
      return '해당 Memory ID 의 기억이 없습니다';
    }
    return (body && (body.error || body.message)) || 'HTTP ' + status;
  }

  function showDetail(visible) {
    setHidden($('mf-detail'), !visible);
    setHidden($('mf-empty'), visible);
  }

  function renderDetail(mem) {
    setField('mf-d-id', mem.id);
    setField('mf-d-type', mem.type);
    setField('mf-d-importance', mem.importance);
    setField('mf-d-privacy', mem.privacy_scope);
    setField('mf-d-pinned', mem.pinned ? '예' : '아니오');
    setField('mf-d-created', mem.created_at);
    setField('mf-d-accessed', mem.last_accessed_at || mem.last_accessed);
    setField('mf-d-tags', mem.tags);
    setField('mf-d-source', mem.source);
    setField('mf-d-project', mem.project_id);
    setField('mf-d-owner', mem.owner_id);
    const content = $('mf-d-content');
    if (content) {
      content.textContent = mem.content === null || mem.content === undefined ? '' : String(mem.content);
      content.scrollTop = 0;
    }
    showDetail(true);
  }

  async function open(memoryId) {
    const id = String(memoryId || '').trim();
    if (!id) {
      showDetail(false);
      setStatus('Memory ID 를 입력하세요');
      return;
    }
    const generation = ++state.generation;
    setStatus('기억 불러오는 중…');
    try {
      const res = await global.mementoAdminFetch(itemUrl(id), { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(function () {
        return {};
      });
      if (generation !== state.generation) {
        return;
      }
      if (!res.ok) {
        showDetail(false);
        setStatus(statusMessage(res.status, body));
        return;
      }
      setStatus('');
      renderDetail((body && body.memory) || {});
    } catch (e) {
      if (generation !== state.generation) {
        return;
      }
      showDetail(false);
      setStatus(e instanceof Error ? e.message : '네트워크 오류');
    }
  }

  function readDeepLinkId() {
    try {
      return new URLSearchParams(global.location ? global.location.search : '').get('memory_id') || '';
    } catch (e) {
      return '';
    }
  }

  function bind() {
    const form = $('mf-id-form');
    const input = $('mf-id-input');
    if (!form || !input) {
      return;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      open(input.value);
    });
    state.bound = true;
  }

  function initMemoryFinderPanel() {
    const finder = global.__MEMENTO_MEMORY_FINDER__;
    if (finder && typeof finder.initSearch === 'function') {
      finder.initSearch();
    }
    if (!state.bound) {
      bind();
    }
    if (state.deepLinkConsumed) {
      return;
    }
    state.deepLinkConsumed = true;
    const id = readDeepLinkId();
    const input = $('mf-id-input');
    if (id && input) {
      input.value = id;
      open(id);
    }
  }

  global.initMemoryFinderPanel = initMemoryFinderPanel;
  global.__MEMENTO_MEMORY_FINDER__ = {
    open: open,
    itemUrl: itemUrl,
    statusMessage: statusMessage,
    readDeepLinkId: readDeepLinkId,
  };
})(typeof window !== 'undefined' ? window : globalThis);
