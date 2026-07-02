/**
 * Review candidates panel poll/SSE cycles.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  ns.runPollCycle = async function () {
    const boot = ns.getReviewQueueBoot();
    const allowHidden = ns.reviewOsNotifyAvailable() && Notification.permission === 'granted';
    if ((document.visibilityState === 'hidden' && !allowHidden) || ns.state.lastPendingCount < 0) {
      ns.schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
      return;
    }
    const body = await ns.fetchQueueSnapshotForPoll(function () { ns.scheduleAfterPollFailure(boot); });
    if (body) ns.applyQueueSnapshot(body, ns.isReviewTabActive(), true, boot);
  };

  ns.onReviewQueueSseChanged = async function () {
    const body = await ns.fetchQueueSnapshotForPoll(ns.resumePollingAfterStreamLoss);
    if (!body) return;
    const onReview = ns.isReviewTabActive();
    if (onReview) {
      ns.applyListSuccess(body);
      return;
    }
    ns.applyQueueSnapshot(body, false, false, null);
  };
})(typeof window !== 'undefined' ? window : globalThis);
