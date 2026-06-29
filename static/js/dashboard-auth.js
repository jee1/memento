/**
 * Dashboard session auth UI.
 * Creates a cookie-backed session via /auth/session and gates dashboard fetches until authenticated.
 */
(function (global) {
  'use strict';

  let authState = 'checking';
  let authRequestVersion = 0;
  let sessionReady = false;
  let sessionPromise = null;
  let resolveSessionPromise = null;

  let rootEl = null;
  let formEl = null;
  let keyInputEl = null;
  let signInButtonEl = null;
  let signOutButtonEl = null;
  let sessionBoxEl = null;
  let statusEl = null;
  let messageEl = null;

  function selectFirst(selectors) {
    for (let i = 0; i < selectors.length; i += 1) {
      const element = document.querySelector(selectors[i]);
      if (element) {
        return element;
      }
    }
    return null;
  }

  function getElementByIdFallback(ids) {
    for (let i = 0; i < ids.length; i += 1) {
      const element = document.getElementById(ids[i]);
      if (element) {
        return element;
      }
    }
    return null;
  }

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


  function maybeActivateTabForAuth(nextState) {
    const tabs = global.__MEMENTO_DASHBOARD_TABS__;
    if (!tabs || typeof tabs.activateTab !== 'function') {
      return;
    }
    if (nextState === 'signed-in') {
      tabs.activateTab('anchor');
      return;
    }
    if (
      nextState === 'signed-out' ||
      nextState === 'checking' ||
      nextState === 'signing-in' ||
      nextState === 'signing-out'
    ) {
      tabs.activateTab('evolution-demo');
    }
  }

  function setMessage(text, tone) {
    if (!messageEl) {
      return;
    }
    messageEl.textContent = text || '';
    messageEl.dataset.tone = tone || 'neutral';
  }

  function updateFormVisibility(nextState) {
    if (formEl) formEl.hidden = nextState === 'signed-in';
    if (sessionBoxEl) sessionBoxEl.hidden = nextState !== 'signed-in';
  }

  function updateInputElements(nextState) {
    const busy = nextState === 'checking' || nextState === 'signing-in';
    if (keyInputEl) keyInputEl.disabled = busy;
    if (signInButtonEl) {
      signInButtonEl.disabled = busy;
      signInButtonEl.textContent = nextState === 'signing-in' ? 'Signing in…' : 'Sign in';
    }
    if (signOutButtonEl) {
      signOutButtonEl.disabled = nextState === 'signing-out';
      signOutButtonEl.textContent = nextState === 'signing-out' ? 'Signing out…' : 'Sign out';
    }
  }

  function updateStatusLabel(nextState) {
    if (!statusEl) return;
    if (nextState === 'signed-in') {
      statusEl.textContent = 'Session active';
    } else if (nextState === 'checking') {
      statusEl.textContent = 'Checking session…';
    } else {
      statusEl.textContent = 'Session required';
    }
  }

  function setAuthState(nextState, message) {
    authState = nextState;
    if (rootEl) rootEl.dataset.authState = nextState;

    updateFormVisibility(nextState);
    updateInputElements(nextState);
    updateStatusLabel(nextState);

    setMessage(message, nextState === 'signed-out' ? 'error' : 'neutral');
    maybeActivateTabForAuth(nextState);
    const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
    if (shell && typeof shell.onAuthStateChanged === 'function') {
      shell.onAuthStateChanged(nextState);
    }
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
    const requestVersion = beginAuthRequest();
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
    const requestVersion = beginAuthRequest();

    const apiKey = keyInputEl ? keyInputEl.value.trim() : '';
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
    rootEl = selectFirst(['.dashboard-container', '.graph-view-container']);
    formEl = getElementByIdFallback(['dashboard-auth-form', 'graph-auth-form']);
    keyInputEl = getElementByIdFallback(['dashboard-api-key', 'graph-api-key']);
    signInButtonEl = getElementByIdFallback(['dashboard-sign-in-btn', 'graph-sign-in-btn']);
    signOutButtonEl = getElementByIdFallback(['dashboard-sign-out-btn', 'graph-sign-out-btn']);
    sessionBoxEl = getElementByIdFallback(['dashboard-auth-session', 'graph-auth-session']);
    statusEl = getElementByIdFallback(['dashboard-auth-status', 'graph-auth-status']);
    messageEl = getElementByIdFallback(['dashboard-auth-message', 'graph-auth-message']);

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
