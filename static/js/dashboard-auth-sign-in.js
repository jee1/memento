/**
 * Dashboard session sign-in flow.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal || !internal.session || !internal.ui) return;

  function handleSignInResponse(response, requestVersion) {
    if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
    if (response.status === 204) {
      internal.ui.clearApiKey();
      internal.session.unlockSessionGate();
      internal.ui.setAuthState('signed-in', '로그인되었습니다. 이후 대시보드 요청은 세션 쿠키를 사용합니다.');
      return;
    }
    return internal.readAuthErrorMessage(response, '대시보드 세션을 만들 수 없습니다.').then(function (message) {
      if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
      internal.session.resetSessionGate();
      internal.ui.setAuthState('signed-out', message);
    });
  }

  internal.handleSignIn = function (event) {
    event.preventDefault();
    const requestVersion = internal.session.beginAuthRequest();
    const apiKey = internal.ui.getApiKey();
    if (!apiKey) {
      internal.ui.setAuthState('signed-out', '대시보드 세션을 만들려면 관리자 API 키를 입력하세요.');
      internal.ui.focusApiKey();
      return;
    }
    internal.ui.setAuthState('signing-in', '대시보드 세션 생성 중…');
    fetch('/auth/session', { method: 'POST', credentials: 'same-origin', headers: { 'X-API-Key': apiKey } })
      .then(function (response) { return handleSignInResponse(response, requestVersion); })
      .catch(function () {
        if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
        internal.session.resetSessionGate();
        internal.ui.setAuthState('signed-out', '/auth/session에 연결할 수 없습니다.');
      });
  };
})(typeof window !== 'undefined' ? window : globalThis);
