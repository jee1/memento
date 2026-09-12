/**
 * Dashboard session auth status label rendering.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.updateAuthStatusLabel = function (elements, nextState) {
    if (!elements.statusEl) return;
    if (nextState === 'signed-in') elements.statusEl.textContent = '세션 활성';
    else if (nextState === 'checking') elements.statusEl.textContent = '세션 확인 중…';
    else elements.statusEl.textContent = '세션 필요';
  };
})(typeof window !== 'undefined' ? window : globalThis);
