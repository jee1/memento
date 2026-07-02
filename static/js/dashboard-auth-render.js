/**
 * Dashboard session auth render facade.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.render = {
    maybeActivateTabForAuth: internal.maybeActivateTabForAuth,
    setMessage: internal.setAuthMessage,
    updateFormVisibility: internal.updateAuthFormVisibility,
    updateInputElements: internal.updateAuthInputElements,
    updateStatusLabel: internal.updateAuthStatusLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
