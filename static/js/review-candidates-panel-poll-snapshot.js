/**
 * Review candidates panel queue snapshot helpers.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  ns.isReviewTabActive = function () {
    const reviewPanel = ns.$('tab-review-candidates');
    return !!(reviewPanel && reviewPanel.classList.contains('active'));
  };

  ns.scheduleAfterPollFailure = function (boot) {
    ns.state.pollFailureStreak += 1;
    let delayMs = boot.pollIntervalMs;
    const steps = boot.pollErrorBackoffMs;
    if (steps.length > 0) delayMs = steps[Math.min(ns.state.pollFailureStreak - 1, steps.length - 1)];
    ns.schedulePollAfterMs(delayMs);
  };

  ns.applyQueueSnapshot = function (body, onReview, fromPoll, boot) {
    const candidates = (body && body.candidates) || [];
    const n = candidates.length;
    const prev = ns.state.lastPendingCount;
    const grew = prev >= 0 && n > prev;
    const fingerprint = ns.buildReviewListFingerprint(candidates);
    const listChanged = fingerprint !== ns.state.lastListFingerprint;
    if (grew) {
      ns.showNewCandidatesToast(n - prev, onReview);
      ns.tryOsNotifyReviewQueueGrowth(n - prev);
      if (!onReview) ns.setReviewTabBadge(n);
    }
    if (onReview && (grew || listChanged)) {
      ns.applyListSuccess(body);
    }
    ns.state.lastPendingCount = n;
    if (fromPoll) ns.schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
  };
})(typeof window !== 'undefined' ? window : globalThis);
