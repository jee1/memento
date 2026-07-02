/**
 * Dashboard session auth status label rendering.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.updateAuthStatusLabel = function (elements, nextState) {
    if (!elements.statusEl) return;
    if (nextState === 'signed-in') elements.statusEl.textContent = 'Session active';
    else if (nextState === 'checking') elements.statusEl.textContent = 'Checking session…';
    else elements.statusEl.textContent = 'Session required';
  };
})(typeof window !== 'undefined' ? window : globalThis);
