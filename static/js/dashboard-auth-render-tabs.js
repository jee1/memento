/**
 * Dashboard session auth tab activation.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  internal.maybeActivateTabForAuth = function (nextState) {
    const tabs = global.__MEMENTO_DASHBOARD_TABS__;
    if (!tabs || typeof tabs.activateTab !== 'function') return;
    if (nextState === 'signed-in') {
      tabs.activateTab('anchor');
      return;
    }
    tabs.activateTab('evolution-demo');
  };
})(typeof window !== 'undefined' ? window : globalThis);
