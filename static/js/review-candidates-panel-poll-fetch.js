/**
 * Review candidates panel queue fetch wrapper.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  ns.fetchQueueSnapshotForPoll = async function (onFailure) {
    try {
      const r = await ns.fetchReviewCandidateListJson();
      if (!r.res.ok) {
        onFailure();
        return null;
      }
      ns.state.pollFailureStreak = 0;
      return r.body;
    } catch {
      onFailure();
      return null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
