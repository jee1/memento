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
      internal.ui.setAuthState('signed-in', 'Signed in with the current browser session.');
      return;
    }
    if (response.status === 401) {
      internal.session.resetSessionGate();
      internal.ui.setAuthState('signed-out', 'Enter the admin API key once to start a dashboard session.');
      return;
    }
    return internal.readAuthErrorMessage(response, 'Could not verify the dashboard session.').then(function (message) {
      if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
      internal.session.resetSessionGate();
      internal.ui.setAuthState('signed-out', message);
    });
  }

  internal.checkSession = function () {
    const requestVersion = internal.session.beginAuthRequest();
    internal.ui.setAuthState('checking', 'Checking for an existing dashboard session…');
    return fetch('/api/anchors/map?agent_id=default', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) { return handleSessionCheckResponse(response, requestVersion); })
      .catch(function () {
        if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
        internal.session.resetSessionGate();
        internal.ui.setAuthState('signed-out', 'Could not reach the server to verify the dashboard session.');
      });
  };
})(typeof window !== 'undefined' ? window : globalThis);
