/**
 * Review candidates panel health registrar (#294, #295, #546).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }
  const required = ['loadHealthMetrics', 'loadBatchRunHistory'];
  for (let i = 0; i < required.length; i += 1) {
    if (typeof ns[required[i]] !== 'function') {
      throw new Error('review-candidates-panel-health: missing ' + required[i]);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
