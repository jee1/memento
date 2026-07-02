/**
 * Dashboard session auth event handler facade.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.requests = {
    checkSession: internal.checkSession,
    handleSignIn: internal.handleSignIn,
    handleSignOut: function () {
      internal.ui.setAuthState('signing-out', 'Clearing dashboard session…');
      fetch('/auth/session', { method: 'DELETE', credentials: 'same-origin' }).finally(function () {
        internal.session.resetSessionGate();
        global.location.reload();
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
