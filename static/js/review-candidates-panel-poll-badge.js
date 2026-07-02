/**
 * Review candidates panel tab badge helpers.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  ns.clearReviewTabBadge = function () {
    const b = ns.$('rc-tab-badge');
    if (!b) return;
    b.textContent = '';
    b.classList.add('hidden');
    b.setAttribute('aria-hidden', 'true');
  };

  ns.setReviewTabBadge = function (totalPending) {
    const b = ns.$('rc-tab-badge');
    if (!b || !(totalPending > 0)) return;
    b.textContent = totalPending > 99 ? '99+' : String(totalPending);
    b.classList.remove('hidden');
    b.setAttribute('aria-hidden', 'false');
  };
})(typeof window !== 'undefined' ? window : globalThis);
