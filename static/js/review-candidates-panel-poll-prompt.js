/**
 * Review candidates panel notification prompt.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) return;

  function isReviewNotifyPromptDismissed() {
    try {
      return !!(global.localStorage && localStorage.getItem(ns.LS_NOTIFY_PROMPT_DISMISSED) === '1');
    } catch {
      return true;
    }
  }

  function dismissReviewNotifyPrompt() {
    try {
      if (global.localStorage) localStorage.setItem(ns.LS_NOTIFY_PROMPT_DISMISSED, '1');
    } catch {
      /* ignore */
    }
  }

  ns.reviewOsNotifyAvailable = function () {
    return !!global.isSecureContext && typeof Notification === 'function';
  };

  ns.syncReviewNotifyPromptUI = function () {
    const wrap = ns.$('rc-notify-prompt');
    if (!wrap) return;
    if (!ns.reviewOsNotifyAvailable() || Notification.permission !== 'default' || isReviewNotifyPromptDismissed()) {
      ns.setHidden(wrap, true);
      return;
    }
    ns.setHidden(wrap, false);
  };

  ns.wireReviewNotifyPrompt = function () {
    if (ns.state.notifyPromptWired) return;
    ns.state.notifyPromptWired = true;
    const enable = ns.$('rc-notify-enable-btn');
    const dismiss = ns.$('rc-notify-dismiss-btn');
    if (enable) enable.addEventListener('click', function () {
      void Notification.requestPermission().catch(function () {}).then(ns.syncReviewNotifyPromptUI);
    });
    if (dismiss) dismiss.addEventListener('click', function () {
      dismissReviewNotifyPrompt();
      ns.syncReviewNotifyPromptUI();
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
