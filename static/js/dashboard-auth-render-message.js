/**
 * Dashboard session auth message rendering.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.setAuthMessage = function (elements, text, tone) {
    if (!elements.messageEl) return;
    elements.messageEl.textContent = text || '';
    elements.messageEl.dataset.tone = tone || 'neutral';
  };
})(typeof window !== 'undefined' ? window : globalThis);
