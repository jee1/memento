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
      internal.ui.setAuthState('signed-in', 'Signed in. Dashboard requests now use the session cookie.');
      return;
    }
    return internal.readAuthErrorMessage(response, 'Could not create the dashboard session.').then(function (message) {
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
      internal.ui.setAuthState('signed-out', 'Enter the admin API key to create a dashboard session.');
      internal.ui.focusApiKey();
      return;
    }
    internal.ui.setAuthState('signing-in', 'Creating dashboard session…');
    fetch('/auth/session', { method: 'POST', credentials: 'same-origin', headers: { 'X-API-Key': apiKey } })
      .then(function (response) { return handleSignInResponse(response, requestVersion); })
      .catch(function () {
        if (!internal.session.isCurrentAuthRequest(requestVersion)) return;
        internal.session.resetSessionGate();
        internal.ui.setAuthState('signed-out', 'Could not reach /auth/session.');
      });
  };
})(typeof window !== 'undefined' ? window : globalThis);
