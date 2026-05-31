/**
 * Review candidates panel - thin init shell (#252+).
 * Companions: shared, render, poll, health (load before this file).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  const state = ns.state;
  const $ = ns.$;

  function initReviewCandidatesPanel() {
    ns.clearReviewTabBadge();
    if (!state.wired) {
      state.wired = true;
      global.addEventListener('beforeunload', function () {
        ns.stopReviewCandidatesStream();
      });
      const btn = $('rc-refresh-btn');
      if (btn) {
        btn.addEventListener('click', function () {
          state.loadedOnce = true;
          ns.loadList();
        });
      }
      const btnReview = $('rc-btn-review');
      if (btnReview) {
        btnReview.addEventListener('click', function () {
          void ns.postCandidateAction('review');
        });
      }
      const btnDismiss = $('rc-btn-dismiss');
      if (btnDismiss) {
        btnDismiss.addEventListener('click', function () {
          void ns.postCandidateAction('dismiss');
        });
      }
      ns.wireReviewNotifyPrompt();
    }
    if (!state.loadedOnce) {
      state.loadedOnce = true;
    }
    ns.syncReviewNotifyPromptUI();
    ns.loadList();
  }

  global.initReviewCandidatesPanel = initReviewCandidatesPanel;
})(typeof window !== 'undefined' ? window : globalThis);
