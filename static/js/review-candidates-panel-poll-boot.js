/**
 * Review queue boot config, read from the server-injected JSON data block.
 *
 * 서버는 <script type="application/json" id="memento-review-queue-boot"> 로 값을 심는다.
 * 예전에는 실행되는 인라인 스크립트로 window.__MEMENTO_REVIEW_QUEUE__ 를 심었는데,
 * CSP script-src 'self' 가 이를 차단해서 폴링 환경설정이 늘 조용히 기본값으로 떨어졌다 (issue 875).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  const BOOT_ELEMENT_ID = 'memento-review-queue-boot';
  const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
  let bootCache = null;

  function readBootJson() {
    if (bootCache) return bootCache;
    const doc = global.document;
    const el = doc && doc.getElementById ? doc.getElementById(BOOT_ELEMENT_ID) : null;
    try {
      bootCache = JSON.parse(el.textContent);
    } catch (e) {
      bootCache = {};
    }
    return bootCache;
  }

  function positiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function getReviewQueueBoot() {
    const boot = readBootJson();
    const backoffRaw = boot.pollErrorBackoffMs;
    return {
      pollIntervalMs: positiveNumber(boot.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS,
      pollErrorBackoffMs: Array.isArray(backoffRaw)
        ? backoffRaw.map(positiveNumber).filter(Boolean)
        : []
    };
  }

  ns.BOOT_ELEMENT_ID = BOOT_ELEMENT_ID;
  ns.getReviewQueueBoot = getReviewQueueBoot;
})(typeof window !== 'undefined' ? window : globalThis);
