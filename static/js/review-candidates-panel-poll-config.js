/**
 * Review candidates panel polling config and timers.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  const state = ns.state;

  function clearPollTimer() {
    if (state.pollTimer !== null) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function schedulePollAfterMs(delayMs) {
    clearPollTimer();
    const boot = ns.getReviewQueueBoot();
    const d = Number(delayMs);
    const safe = Number.isFinite(d) && d > 0 ? d : boot.pollIntervalMs;
    state.pollTimer = setTimeout(function () {
      state.pollTimer = null;
      void ns.runPollCycle();
    }, safe);
  }

  function schedulePollAfterMsUnlessSse(delayMs) {
    if (typeof EventSource !== 'undefined' && state.reviewSse && state.reviewSse.readyState === EventSource.OPEN) {
      return;
    }
    schedulePollAfterMs(delayMs);
  }

  ns.clearPollTimer = clearPollTimer;
  ns.schedulePollAfterMs = schedulePollAfterMs;
  ns.schedulePollAfterMsUnlessSse = schedulePollAfterMsUnlessSse;
})(typeof window !== 'undefined' ? window : globalThis);
