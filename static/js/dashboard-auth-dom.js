/**
 * Dashboard session auth DOM lookup and binding.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  const elements = {};

  function selectFirst(selectors) {
    for (let i = 0; i < selectors.length; i += 1) {
      const element = document.querySelector(selectors[i]);
      if (element) return element;
    }
    return null;
  }

  function getElementByIdFallback(ids) {
    for (let i = 0; i < ids.length; i += 1) {
      const element = document.getElementById(ids[i]);
      if (element) return element;
    }
    return null;
  }

  internal.dom = {
    elements: elements,
    bindDom: function (handlers) {
      elements.rootEl = selectFirst(['.dashboard-container', '.graph-view-container']);
      elements.formEl = getElementByIdFallback(['dashboard-auth-form', 'graph-auth-form']);
      elements.keyInputEl = getElementByIdFallback(['dashboard-api-key', 'graph-api-key']);
      elements.signInButtonEl = getElementByIdFallback(['dashboard-sign-in-btn', 'graph-sign-in-btn']);
      elements.signOutButtonEl = getElementByIdFallback(['dashboard-sign-out-btn', 'graph-sign-out-btn']);
      elements.sessionBoxEl = getElementByIdFallback(['dashboard-auth-session', 'graph-auth-session']);
      elements.statusEl = getElementByIdFallback(['dashboard-auth-status', 'graph-auth-status']);
      elements.messageEl = getElementByIdFallback(['dashboard-auth-message', 'graph-auth-message']);
      if (elements.formEl) elements.formEl.addEventListener('submit', handlers.handleSignIn);
      if (elements.signOutButtonEl) elements.signOutButtonEl.addEventListener('click', handlers.handleSignOut);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
