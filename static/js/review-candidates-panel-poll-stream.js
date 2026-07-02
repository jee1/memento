/**
 * Review candidates panel EventSource startup and polling fallback.
 */
(function (global) {
  'use strict';
  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;
  const state = ns.state;
  function registerVisibilityForPoll() {
    if (state.visListenerRegistered) return;
    state.visListenerRegistered = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') void ns.runPollCycle();
    });
  }
  function startPollingIfNeeded() {
    if (state.pollTimer !== null) return;
    registerVisibilityForPoll();
    ns.schedulePollAfterMs(ns.getReviewQueueBoot().pollIntervalMs);
  }
  function stopReviewCandidatesStream() {
    if (!state.reviewSse) return;
    state.reviewSse.close();
    state.reviewSse = null;
  }
  function resumePollingAfterStreamLoss() {
    stopReviewCandidatesStream();
    startPollingIfNeeded();
  }
  function maybeStartReviewCandidatesEventSource() {
    if (typeof EventSource === 'undefined') return startPollingIfNeeded();
    if (state.reviewSse) return;
    try {
      state.reviewSse = new EventSource(ns.STREAM_URL);
    } catch {
      state.reviewSse = null;
      startPollingIfNeeded();
      return;
    }
    state.reviewSse.addEventListener('open', function () {
      ns.clearPollTimer();
      state.pollFailureStreak = 0;
    });
    state.reviewSse.addEventListener('changed', function () { void ns.onReviewQueueSseChanged(); });
    state.reviewSse.onerror = resumePollingAfterStreamLoss;
  }
  ns.startPollingIfNeeded = startPollingIfNeeded;
  ns.stopReviewCandidatesStream = stopReviewCandidatesStream;
  ns.resumePollingAfterStreamLoss = resumePollingAfterStreamLoss;
  ns.maybeStartReviewCandidatesEventSource = maybeStartReviewCandidatesEventSource;
})(typeof window !== 'undefined' ? window : globalThis);
