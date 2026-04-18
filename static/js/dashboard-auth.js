/**
 * Dashboard session auth UI.
 * Creates a cookie-backed session via /auth/session and gates dashboard fetches until authenticated.
 */
(function (global) {
  'use strict';

  var authState = 'checking';
  var authRequestVersion = 0;
  var sessionReady = false;
  var sessionPromise = null;
  var resolveSessionPromise = null;

  var rootEl = null;
  var formEl = null;
  var keyInputEl = null;
  var signInButtonEl = null;
  var signOutButtonEl = null;
  var sessionBoxEl = null;
  var statusEl = null;
  var messageEl = null;

  function beginAuthRequest() {
    authRequestVersion += 1;
    return authRequestVersion;
  }

  function isCurrentAuthRequest(requestVersion) {
    return requestVersion === authRequestVersion;
  }

  function createSessionGate() {
    sessionReady = false;
    sessionPromise = new Promise(function (resolve) {
      resolveSessionPromise = resolve;
    });
  }

  function ensureSessionGate() {
    if (!sessionPromise) {
      createSessionGate();
    }
  }

  function unlockSessionGate() {
    ensureSessionGate();
    if (sessionReady) {
      return;
    }
    sessionReady = true;
    if (resolveSessionPromise) {
      resolveSessionPromise();
    }
  }

  function resetSessionGate() {
    if (!sessionReady && sessionPromise) {
      return;
    }
    createSessionGate();
  }

  function setMessage(text, tone) {
    if (!messageEl) {
      return;
    }
    messageEl.textContent = text || '';
    messageEl.dataset.tone = tone || 'neutral';
  }

  function setAuthState(nextState, message) {
    authState = nextState;
    if (rootEl) {
      rootEl.dataset.authState = nextState;
    }

    if (formEl) {
      formEl.hidden = nextState === 'signed-in';
    }
    if (sessionBoxEl) {
      sessionBoxEl.hidden = nextState !== 'signed-in';
    }
    if (keyInputEl) {
      keyInputEl.disabled = nextState === 'checking' || nextState === 'signing-in';
    }
    if (signInButtonEl) {
      signInButtonEl.disabled = nextState === 'checking' || nextState === 'signing-in';
      signInButtonEl.textContent = nextState === 'signing-in' ? 'Signing in…' : 'Sign in';
    }
    if (signOutButtonEl) {
      signOutButtonEl.disabled = nextState === 'signing-out';
      signOutButtonEl.textContent = nextState === 'signing-out' ? 'Signing out…' : 'Sign out';
    }

    if (statusEl) {
      if (nextState === 'signed-in') {
        statusEl.textContent = 'Session active';
      } else if (nextState === 'checking') {
        statusEl.textContent = 'Checking session…';
      } else {
        statusEl.textContent = 'Session required';
      }
    }

    setMessage(message, nextState === 'signed-out' ? 'error' : 'neutral');
  }

  function readErrorMessage(response, fallbackMessage) {
    return response
      .json()
      .then(function (payload) {
        if (payload && typeof payload.message === 'string' && payload.message.trim() !== '') {
          return payload.message.trim();
        }
        return fallbackMessage;
      })
      .catch(function () {
        return fallbackMessage;
      });
  }

  function checkSession() {
    var requestVersion = beginAuthRequest();
    setAuthState('checking', 'Checking for an existing dashboard session…');

    return fetch('/api/anchors/map?agent_id=default', {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json'
      }
    }).then(function (response) {
      if (!isCurrentAuthRequest(requestVersion)) {
        return;
      }

      if (response.ok) {
        unlockSessionGate();
        setAuthState('signed-in', 'Signed in with the current browser session.');
        return;
      }

      if (response.status === 401) {
        resetSessionGate();
        setAuthState('signed-out', 'Enter the admin API key once to start a dashboard session.');
        return;
      }

      return readErrorMessage(response, 'Could not verify the dashboard session.').then(function (message) {
        if (!isCurrentAuthRequest(requestVersion)) {
          return;
        }
        resetSessionGate();
        setAuthState('signed-out', message);
      });
    }).catch(function () {
      if (!isCurrentAuthRequest(requestVersion)) {
        return;
      }
      resetSessionGate();
      setAuthState('signed-out', 'Could not reach the server to verify the dashboard session.');
    });
  }

  function handleSignIn(event) {
    event.preventDefault();
    var requestVersion = beginAuthRequest();

    var apiKey = keyInputEl ? keyInputEl.value.trim() : '';
    if (!apiKey) {
      setAuthState('signed-out', 'Enter the admin API key to create a dashboard session.');
      if (keyInputEl) {
        keyInputEl.focus();
      }
      return;
    }

    setAuthState('signing-in', 'Creating dashboard session…');

    fetch('/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-API-Key': apiKey
      }
    }).then(function (response) {
      if (!isCurrentAuthRequest(requestVersion)) {
        return;
      }

      if (response.status === 204) {
        if (keyInputEl) {
          keyInputEl.value = '';
        }
        unlockSessionGate();
        setAuthState('signed-in', 'Signed in. Dashboard requests now use the session cookie.');
        return;
      }

      return readErrorMessage(response, 'Could not create the dashboard session.').then(function (message) {
        if (!isCurrentAuthRequest(requestVersion)) {
          return;
        }
        resetSessionGate();
        setAuthState('signed-out', message);
      });
    }).catch(function () {
      if (!isCurrentAuthRequest(requestVersion)) {
        return;
      }
      resetSessionGate();
      setAuthState('signed-out', 'Could not reach /auth/session.');
    });
  }

  function handleSignOut() {
    setAuthState('signing-out', 'Clearing dashboard session…');

    fetch('/auth/session', {
      method: 'DELETE',
      credentials: 'same-origin'
    }).finally(function () {
      resetSessionGate();
      global.location.reload();
    });
  }

  function bindDom() {
    rootEl = document.querySelector('.dashboard-container');
    formEl = document.getElementById('dashboard-auth-form');
    keyInputEl = document.getElementById('dashboard-api-key');
    signInButtonEl = document.getElementById('dashboard-sign-in-btn');
    signOutButtonEl = document.getElementById('dashboard-sign-out-btn');
    sessionBoxEl = document.getElementById('dashboard-auth-session');
    statusEl = document.getElementById('dashboard-auth-status');
    messageEl = document.getElementById('dashboard-auth-message');

    if (formEl) {
      formEl.addEventListener('submit', handleSignIn);
    }
    if (signOutButtonEl) {
      signOutButtonEl.addEventListener('click', handleSignOut);
    }
  }

  ensureSessionGate();

  global.__MEMENTO_DASHBOARD_AUTH__ = {
    waitForSession: function () {
      ensureSessionGate();
      return sessionReady ? Promise.resolve() : sessionPromise;
    },
    handleUnauthorized: function () {
      resetSessionGate();
      setAuthState('signed-out', 'Dashboard session expired. Sign in again to continue.');
    },
    getState: function () {
      return authState;
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    bindDom();
    checkSession();
  });
})(typeof window !== 'undefined' ? window : globalThis);
