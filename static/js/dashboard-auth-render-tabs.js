/**
 * Dashboard session auth tab activation.
 */
(function (global) {
  'use strict';

  const internal = global.__MEMENTO_DASHBOARD_AUTH_INTERNAL__;
  if (!internal) return;

  function hasMemoryIdDeepLink() {
    try {
      return Boolean(new URLSearchParams(global.location ? global.location.search : '').get('memory_id'));
    } catch (e) {
      return false;
    }
  }

  internal.maybeActivateTabForAuth = function (nextState) {
    const tabs = global.__MEMENTO_DASHBOARD_TABS__;
    if (!tabs || typeof tabs.activateTab !== 'function') return;
    if (nextState === 'signed-in') {
      // #965: cold load / post-sign-in default = Anchor Map (badge alone must not jump to Review)
      // #1118: ?memory_id=… deep link opens the memory finder instead of the default tab
      if (hasMemoryIdDeepLink()) {
        tabs.activateTab('memory-finder');
        return;
      }
      tabs.activateTab('anchor');
      return;
    }
    tabs.activateTab('evolution-demo');
  };
})(typeof window !== 'undefined' ? window : globalThis);
