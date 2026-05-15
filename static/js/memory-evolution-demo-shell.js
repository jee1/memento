/**
 * Memory evolution demo tab — shell only (#340).
 * View states: loading | empty | error | ready (no API fetch).
 */
(function (global) {
  'use strict';

  const VALID_STATES = ['loading', 'empty', 'error', 'ready'];

  let viewState = 'empty';
  let bound = false;

  const els = {
    loading: null,
    empty: null,
    error: null,
    content: null,
  };

  function bindDom() {
    if (bound) {
      return;
    }
    els.loading = document.getElementById('med-loading');
    els.empty = document.getElementById('med-empty');
    els.error = document.getElementById('med-error');
    els.content = document.getElementById('med-content');
    bound = Boolean(els.loading && els.empty && els.error && els.content);
  }

  function setVisible(el, visible) {
    if (!el) {
      return;
    }
    el.classList.toggle('hidden', !visible);
  }

  function setViewState(state) {
    if (VALID_STATES.indexOf(state) < 0) {
      return;
    }
    bindDom();
    if (!bound) {
      return;
    }
    viewState = state;
    setVisible(els.loading, state === 'loading');
    setVisible(els.empty, state === 'empty');
    setVisible(els.error, state === 'error');
    setVisible(els.content, state === 'ready');
  }

  function init() {
    bindDom();
    setViewState(viewState);
  }

  global.__MEMENTO_EVOLUTION_DEMO_SHELL__ = {
    init: init,
    setViewState: setViewState,
    getViewState: function () {
      return viewState;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
