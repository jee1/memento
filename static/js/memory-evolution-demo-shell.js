/**
 * Memory evolution demo tab - thin init shell (#340, #342, #395, #445).
 * Companions: shared, render, data (load before this file).
 * View states: loading | empty | error | ready
 */
(function (global) {
  'use strict';

  const shell = global.__MEMENTO_EVOLUTION_DEMO_SHELL__;
  if (!shell || !shell.internal) {
    return;
  }
  const ns = shell.internal;

  function init() {
    ns.bindDom();
    if (!ns.canLoadFromApi()) {
      ns.showAuthRequiredState();
      return;
    }
    ns.setViewState(ns.viewState);
  }

  global.__MEMENTO_EVOLUTION_DEMO_SHELL__ = {
    init: init,
    initPanel: ns.initPanel,
    refresh: ns.refresh,
    showAuthRequiredState: ns.showAuthRequiredState,
    onAuthStateChanged: ns.onAuthStateChanged,
    setViewState: ns.setViewState,
    getViewState: function () {
      return ns.viewState;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
