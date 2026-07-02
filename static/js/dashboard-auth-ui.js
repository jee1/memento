/**
 * Dashboard session auth UI facade.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal || !internal.dom || !internal.render) return;

  internal.ui = {
    bindDom: internal.dom.bindDom,
    clearApiKey: function () {
      const input = internal.dom.elements.keyInputEl;
      if (input) input.value = '';
    },
    focusApiKey: function () {
      const input = internal.dom.elements.keyInputEl;
      if (input) input.focus();
    },
    getApiKey: function () {
      const input = internal.dom.elements.keyInputEl;
      return input ? input.value.trim() : '';
    },
    setAuthState: function (nextState, message) {
      const elements = internal.dom.elements;
      internal.state.authState = nextState;
      if (elements.rootEl) elements.rootEl.dataset.authState = nextState;
      internal.render.updateFormVisibility(elements, nextState);
      internal.render.updateInputElements(elements, nextState);
      internal.render.updateStatusLabel(elements, nextState);
      internal.render.setMessage(elements, message, nextState === 'signed-out' ? 'error' : 'neutral');
      internal.render.maybeActivateTabForAuth(nextState);
      const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
      if (shell && typeof shell.onAuthStateChanged === 'function') shell.onAuthStateChanged(nextState);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
