/**
 * Dashboard session auth state and request version gate.
 */
(function (global) {
  'use strict';
  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__ || {};
  global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__ = internal;
  const state = internal.state || {
    authState: 'checking',
    authRequestVersion: 0,
    sessionReady: false,
    sessionPromise: null,
    resolveSessionPromise: null
  };
  internal.state = state;
  function createSessionGate() {
    state.sessionReady = false;
    state.sessionPromise = new Promise(function (resolve) {
      state.resolveSessionPromise = resolve;
    });
  }
  function ensureSessionGate() {
    if (!state.sessionPromise) createSessionGate();
  }
  function unlockSessionGate() {
    ensureSessionGate();
    if (state.sessionReady) return;
    state.sessionReady = true;
    if (state.resolveSessionPromise) state.resolveSessionPromise();
  }
  function resetSessionGate() {
    if (!state.sessionReady && state.sessionPromise) return;
    createSessionGate();
  }
  internal.session = {
    beginAuthRequest: function () {
      state.authRequestVersion += 1;
      return state.authRequestVersion;
    },
    ensureSessionGate: ensureSessionGate,
    isCurrentAuthRequest: function (requestVersion) {
      return requestVersion === state.authRequestVersion;
    },
    resetSessionGate: resetSessionGate,
    unlockSessionGate: unlockSessionGate
  };
})(typeof window !== 'undefined' ? window : globalThis);
