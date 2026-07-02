/**
 * Dashboard session auth form and input rendering.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.updateAuthFormVisibility = function (elements, nextState) {
    if (elements.formEl) elements.formEl.hidden = nextState === 'signed-in';
    if (elements.sessionBoxEl) elements.sessionBoxEl.hidden = nextState !== 'signed-in';
  };

  internal.updateAuthInputElements = function (elements, nextState) {
    const busy = nextState === 'checking' || nextState === 'signing-in';
    if (elements.keyInputEl) elements.keyInputEl.disabled = busy;
    if (elements.signInButtonEl) {
      elements.signInButtonEl.disabled = busy;
      elements.signInButtonEl.textContent = nextState === 'signing-in' ? 'Signing in…' : 'Sign in';
    }
    if (elements.signOutButtonEl) {
      elements.signOutButtonEl.disabled = nextState === 'signing-out';
      elements.signOutButtonEl.textContent = nextState === 'signing-out' ? 'Signing out…' : 'Sign out';
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
