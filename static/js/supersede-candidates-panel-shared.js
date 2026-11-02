(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_SUPERSEDE_CANDIDATES_PANEL__ = global.__MEMENTO_SUPERSEDE_CANDIDATES_PANEL__ || {});

  ns.LIST_URL = '/admin/memory/supersede-candidates?page_size=25&page=1';
  ns.S = {
    loadFailed: '대체 후보 목록을 불러오지 못했습니다.',
    empty: '표시할 후보가 없습니다.',
    applyDisabled: 'SUPERSEDE_APPLY_ENABLED 가 꺼져 있어 승인할 수 없습니다.',
    selectRow: '목록에서 후보를 선택하세요.',
    actionFailed: function (code) {
      return code ? '요청 실패: ' + code : '요청 실패';
    },
    lifecycleLabel: {
      not_applied: '미적용',
      applied: '적용됨',
      restored: '복원됨',
      dismissed: '거절됨',
    },
  };

  ns.state = ns.state || {
    wired: false,
    loadedOnce: false,
    candidates: [],
    selectedId: null,
    pagination: null,
    inFlight: false,
  };

  ns.$ = function (id) {
    return document.getElementById(id);
  };

  ns.setHidden = function (el, hidden) {
    if (el) {
      el.classList.toggle('hidden', hidden);
    }
  };

  ns.apiFetch = function (path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}));
  };

  ns.buildListUrl = function () {
    const project = ns.$('sc-filter-project');
    const lifecycle = ns.$('sc-filter-lifecycle');
    const parts = ['page_size=25', 'page=1'];
    if (project && project.value.trim()) {
      parts.push('project_id=' + encodeURIComponent(project.value.trim()));
    }
    if (lifecycle && lifecycle.value) {
      parts.push('lifecycle_status=' + encodeURIComponent(lifecycle.value));
    }
    return '/admin/memory/supersede-candidates?' + parts.join('&');
  };
})(typeof window !== 'undefined' ? window : globalThis);
