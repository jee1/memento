/**
 * Dashboard session auth form and input rendering.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.updateAuthFormVisibility = function (elements, nextState) {
    if (elements.formEl) elements.formEl.hidden = nextState === 'signed-in';
    if (elements.sessionBoxEl) elements.sessionBoxEl.hidden = nextState !== 'signed-in';
  };

  internal.updateAuthInputElements = function (elements, nextState) {
    const busy = nextState === 'checking' || nextState === 'signing-in';
    if (elements.keyInputEl) elements.keyInputEl.disabled = busy;
    if (elements.signInButtonEl) {
      elements.signInButtonEl.disabled = busy;
      elements.signInButtonEl.textContent = nextState === 'signing-in' ? '로그인 중…' : '로그인';
    }
    if (elements.signOutButtonEl) {
      elements.signOutButtonEl.disabled = nextState === 'signing-out';
      elements.signOutButtonEl.textContent = nextState === 'signing-out' ? '로그아웃 중…' : '로그아웃';
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
