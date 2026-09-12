/**
 * Review candidates panel operating-system notification dispatch.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  function tryOsNotifyReviewQueueGrowth(delta) {
    if (!ns.reviewOsNotifyAvailable() || Notification.permission !== 'granted') return;
    if (document.visibilityState !== 'hidden') return;
    const body = delta === 1
      ? '검토 대기열에 새 항목이 1건 있습니다.'
      : '검토 대기열에 새 항목이 ' + String(delta) + '건 있습니다.';
    try {
      const n = new Notification('Memento — 검토 대기열', { body: body, tag: ns.OS_NOTIFY_TAG });
      n.onclick = function () {
        try { global.focus(); } catch { /* ignore */ }
        try { n.close(); } catch { /* ignore */ }
      };
    } catch {
      /* OS or browser blocked notification */
    }
  }

  ns.tryOsNotifyReviewQueueGrowth = tryOsNotifyReviewQueueGrowth;
})(typeof window !== 'undefined' ? window : globalThis);
