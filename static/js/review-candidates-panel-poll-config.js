/**
 * Review candidates panel polling config and timers.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  const state = ns.state;

  // 서버가 심는 <script type="application/json"> 데이터 블록에서 읽는다. 예전에는 실행되는
  // 인라인 스크립트로 window.__MEMENTO_REVIEW_QUEUE__ 를 심었는데, CSP script-src 'self' 가
  // 이를 차단해서 폴링 환경설정이 늘 조용히 기본값으로 떨어졌다 (issue 875).
  const BOOT_ELEMENT_ID = 'memento-review-queue-boot';
  let bootCache = null;

  function readBootJson() {
    if (bootCache !== null) return bootCache;
    const doc = global.document;
    const el = doc && typeof doc.getElementById === 'function' ? doc.getElementById(BOOT_ELEMENT_ID) : null;
    try {
      bootCache = el ? JSON.parse(el.textContent) : {};
    } catch (e) {
      bootCache = {};
    }
    return bootCache;
  }

  function getReviewQueueBoot() {
    const b = readBootJson();
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
  ns.BOOT_ELEMENT_ID = BOOT_ELEMENT_ID;
  ns.clearPollTimer = clearPollTimer;
  ns.schedulePollAfterMs = schedulePollAfterMs;
  ns.schedulePollAfterMsUnlessSse = schedulePollAfterMsUnlessSse;
})(typeof window !== 'undefined' ? window : globalThis);
