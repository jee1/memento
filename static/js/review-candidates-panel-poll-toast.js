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
      ? '검토 후보가 1건 늘었습니다(대기열 증가).'
      : String(delta) + '건의 검토 후보가 늘었습니다(대기열 증가).';
    t.textContent = msg + (onReviewTab ? ' 목록을 갱신했습니다.' : ' 검토 대기열을 열어 새로고침하세요.');
    t.classList.remove('hidden');
    if (ns.state.toastHideTimer) clearTimeout(ns.state.toastHideTimer);
    ns.state.toastHideTimer = setTimeout(function () {
      t.classList.add('hidden');
      t.textContent = '';
      ns.state.toastHideTimer = null;
    }, 8000);
  };
})(typeof window !== 'undefined' ? window : globalThis);
