/**
 * Memory finder search mode (#1118 Phase 2).
 * GET /admin/memory/search returns previews; clicking a result opens the full memory
 * through the panel's open() (GET /admin/memory/items/:memory_id).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_MEMORY_FINDER__;
  if (!ns) {
    return;
  }

  const state = { bound: false, generation: 0 };

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

  function searchUrl(q, type, limit) {
    const params = new URLSearchParams();
    params.set('q', q);
    if (type) {
      params.set('type', type);
    }
    params.set('limit', limit || '25');
    return '/admin/memory/search?' + params.toString();
  }

  function errorMessage(status, body) {
    if (status === 400) {
      return '검색 조건이 올바르지 않습니다';
    }
    if (status === 503) {
      return '검색 엔진을 사용할 수 없습니다';
    }
    return (body && (body.error || body.message)) || 'HTTP ' + status;
  }

  function formatScore(value) {
    return typeof value === 'number' && isFinite(value) ? value.toFixed(2) : '—';
  }

  function setMode(mode) {
    const searchMode = mode === 'search';
    setHidden($('mf-id-form'), searchMode);
    setHidden($('mf-search-form'), !searchMode);
    const list = $('mf-results');
    setHidden(list, !searchMode || !list || !list.firstChild);
    setStatus('');
  }

  function renderResultItem(item) {
    const doc = global.document;
    const li = doc.createElement('li');
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'memory-finder-result';
    button.setAttribute('data-memory-id', String(item.id || ''));
    const head = doc.createElement('span');
    head.className = 'memory-finder-result__head rc-cell-mono';
    head.textContent = String(item.id || '') + ' · ' + String(item.type || '') + ' · ' + formatScore(item.similarity);
    const preview = doc.createElement('span');
    preview.className = 'memory-finder-result__preview';
    preview.textContent = String(item.content_preview || '');
    button.appendChild(head);
    button.appendChild(preview);
    button.addEventListener('click', function () {
      ns.open(item.id);
    });
    li.appendChild(button);
    return li;
  }

  function renderResults(items) {
    const list = $('mf-results');
    if (!list) {
      return;
    }
    list.textContent = '';
    items.forEach(function (item) {
      list.appendChild(renderResultItem(item));
    });
    setHidden(list, items.length === 0);
  }

  async function search(q, type, limit) {
    const query = String(q || '').trim();
    if (!query) {
      setStatus('검색어를 입력하세요');
      return;
    }
    const generation = ++state.generation;
    setStatus('검색 중…');
    try {
      const res = await global.mementoAdminFetch(searchUrl(query, type, limit), {
        headers: { Accept: 'application/json' },
      });
      const body = await res.json().catch(function () {
        return {};
      });
      if (generation !== state.generation) {
        return;
      }
      if (!res.ok) {
        renderResults([]);
        setStatus(errorMessage(res.status, body));
        return;
      }
      const items = Array.isArray(body && body.items) ? body.items : [];
      renderResults(items);
      setStatus(items.length === 0 ? '검색 결과가 없습니다' : '결과 ' + items.length + '건');
    } catch (e) {
      if (generation !== state.generation) {
        return;
      }
      renderResults([]);
      setStatus(e instanceof Error ? e.message : '네트워크 오류');
    }
  }

  function bind() {
    const form = $('mf-search-form');
    const input = $('mf-search-input');
    if (!form || !input) {
      return;
    }
    ['mf-mode-id', 'mf-mode-search'].forEach(function (id) {
      const radio = $(id);
      if (radio) {
        radio.addEventListener('change', function () {
          if (radio.checked) {
            setMode(radio.value);
          }
        });
      }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const type = $('mf-search-type');
      const limit = $('mf-search-limit');
      search(input.value, type ? type.value : '', limit ? limit.value : '25');
    });
    state.bound = true;
  }

  function initSearch() {
    if (!state.bound) {
      bind();
    }
  }

  ns.initSearch = initSearch;
  ns.search = search;
  ns.searchUrl = searchUrl;
  ns.setMode = setMode;
})(typeof window !== 'undefined' ? window : globalThis);
