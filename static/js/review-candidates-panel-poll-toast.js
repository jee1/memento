/**
 * Review candidates panel new-candidate toast.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  ns.showNewCandidatesToast = function (delta, onReviewTab) {
    const t = ns.$('rc-toast');
    if (!t) return;
    const msg = delta === 1
      ? '1 new review candidate (pending queue grew).'
      : String(delta) + ' new review candidates (pending queue grew).';
    t.textContent = msg + (onReviewTab ? ' List updated.' : ' Open Review Queue to refresh.');
    t.classList.remove('hidden');
    if (ns.state.toastHideTimer) clearTimeout(ns.state.toastHideTimer);
    ns.state.toastHideTimer = setTimeout(function () {
      t.classList.add('hidden');
      t.textContent = '';
      ns.state.toastHideTimer = null;
    }, 8000);
  };
})(typeof window !== 'undefined' ? window : globalThis);
