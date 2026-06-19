/**
 * Review candidates panel render registrar (#252-#254, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }
  const required = [
    'loadList',
    'renderTable',
    'postCandidateAction',
    'syncReviewDismissButtons',
    'showError',
  ];
  for (let i = 0; i < required.length; i += 1) {
    if (typeof ns[required[i]] !== 'function') {
      throw new Error('review-candidates-panel-render: missing ' + required[i]);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
