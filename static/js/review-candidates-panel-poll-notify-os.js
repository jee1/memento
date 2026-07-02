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
      ? 'The pending review queue has 1 new item.'
      : 'The pending review queue has ' + String(delta) + ' new items.';
    try {
      const n = new Notification('Memento — Review queue', { body: body, tag: ns.OS_NOTIFY_TAG });
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
