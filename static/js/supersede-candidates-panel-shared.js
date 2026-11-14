(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_SUPERSEDE_CANDIDATES_PANEL__ = global.__MEMENTO_SUPERSEDE_CANDIDATES_PANEL__ || {});

  ns.LIST_URL = '/admin/memory/supersede-candidates?page_size=25&page=1';
  ns.S = {
    loadFailed: '대체 후보 목록을 불러오지 못했습니다.',
    empty: '표시할 후보가 없습니다.',
    applyDisabled: '대체 승인이 꺼져 있어 승인할 수 없습니다. 설정 탭에서 켜세요.',
    verdictNotApplicable: '양립 판정 같은 비승인 판정(확정 대체와 확인 대기만 승인)은 서버에서 거절됩니다.',
    alreadySupersededBlocked:
      '옛 기억이 이미 다른 대상으로 대체되었습니다. 추가 승인은 서버에서 거절됩니다. 필요하면 되돌린 뒤 거절하세요.',
    targetDeletedApplyHint:
      '새 기억(대상)이 소프트 삭제되었습니다. 먼저 되돌린 뒤 거절하세요. 되돌리기로 옛 기억의 연결을 정리하면 거절할 수 있습니다. 승인은 복구되기 전까지 서버에서 거절됩니다.',
    danglingPointerRestoreFirst:
      '끊긴 연결입니다. 먼저 되돌리기로 옛 기억의 연결을 정리한 뒤 승인하세요.',
    selectRow: '목록에서 후보를 선택하세요.',
    evidenceQuoteMissing: '인용 근거 없음',
    actionFailed: function (code) {
      return code ? '요청 실패: ' + code : '요청 실패';
    },
    verdictLabel: {
      confirmed: '확정 대체',
      pending: '확인 대기',
      compatible: '양립',
    },
    lifecycleLabel: {
      not_applied: '미적용',
      applied: '적용됨',
      target_deleted: '대상 삭제(옛 기억 노출)',
      dangling_pointer: '끊긴 연결',
      restored: '복원됨',
      dismissed: '거절됨',
    },
  };

  ns.state = ns.state || {
    wired: false,
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
    const doFetch = typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
    return doFetch(path, Object.assign({ credentials: 'same-origin' }, options || {}));
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
