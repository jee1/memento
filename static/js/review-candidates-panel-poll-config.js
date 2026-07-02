/**
 * Review candidates panel polling config and timers.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  const state = ns.state;

  function getReviewQueueBoot() {
    const b = global.__MEMENTO_REVIEW_QUEUE__;
    const pollRaw = b && Number(b.pollIntervalMs);
    const pollIntervalMs = Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : 60 * 1000;
    const backoffRaw = b && b.pollErrorBackoffMs;
    const pollErrorBackoffMs = Array.isArray(backoffRaw)
      ? backoffRaw.map(function (x) { return Number(x); }).filter(function (n) { return Number.isFinite(n) && n > 0; })
      : [];
    return { pollIntervalMs: pollIntervalMs, pollErrorBackoffMs: pollErrorBackoffMs };
  }

  function clearPollTimer() {
    if (state.pollTimer !== null) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function schedulePollAfterMs(delayMs) {
    clearPollTimer();
    const boot = getReviewQueueBoot();
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

  ns.getReviewQueueBoot = getReviewQueueBoot;
  ns.clearPollTimer = clearPollTimer;
  ns.schedulePollAfterMs = schedulePollAfterMs;
  ns.schedulePollAfterMsUnlessSse = schedulePollAfterMsUnlessSse;
})(typeof window !== 'undefined' ? window : globalThis);
