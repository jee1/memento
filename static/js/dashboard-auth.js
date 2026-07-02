/**
 * Dashboard session auth UI bootstrap.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal || !internal.session || !internal.ui || !internal.requests) return;

  internal.session.ensureSessionGate();

  global.__MEMENTO_DASHBOARD_AUTH__ = {
    waitForSession: function () {
      internal.session.ensureSessionGate();
      return internal.state.sessionReady ? Promise.resolve() : internal.state.sessionPromise;
    },
    handleUnauthorized: function () {
      internal.session.resetSessionGate();
      internal.ui.setAuthState('signed-out', 'Dashboard session expired. Sign in again to continue.');
    },
    getState: function () {
      return internal.state.authState;
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    internal.ui.bindDom(internal.requests);
    internal.requests.checkSession();
  });
})(typeof window !== 'undefined' ? window : globalThis);
