/**
 * Dashboard session startup probe.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal || !internal.session || !internal.ui) return;

  function handleSessionCheckResponse(response, requestVersion) {
    if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
    if (response.ok) {
      internal.session.unlockSessionGate();
      internal.ui.setAuthState('signed-in', '현재 브라우저 세션으로 로그인되어 있습니다.');
      return;
    }
    if (response.status === 401) {
      internal.session.resetSessionGate();
      internal.ui.setAuthState('signed-out', '대시보드 세션을 시작하려면 관리자 API 키를 한 번 입력하세요.');
      return;
    }
    return internal.readAuthErrorMessage(response, '대시보드 세션을 확인할 수 없습니다.').then(function (message) {
      if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
      internal.session.resetSessionGate();
      internal.ui.setAuthState('signed-out', message);
    });
  }

  internal.checkSession = function () {
    const requestVersion = internal.session.beginAuthRequest();
    internal.ui.setAuthState('checking', '기존 대시보드 세션 확인 중…');
    return fetch('/api/anchors/map?agent_id=default', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) { return handleSessionCheckResponse(response, requestVersion); })
      .catch(function () {
        if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
        internal.session.resetSessionGate();
        internal.ui.setAuthState('signed-out', '대시보드 세션을 확인하기 위해 서버에 연결할 수 없습니다.');
      });
  };
})(typeof window !== 'undefined' ? window : globalThis);
