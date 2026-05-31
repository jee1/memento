/**
 * Review candidates panel — poll/SSE fallback, OS notify, toast, tab badge (#255, #274–#276).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
  if (!ns) {
    return;
  }

  const $ = ns.$;
  const setHidden = ns.setHidden;
  const state = ns.state;

  function getReviewQueueBoot() {
    const b = global.__MEMENTO_REVIEW_QUEUE__;
    const fallbackPoll = 60 * 1000;
    const pollRaw = b && Number(b.pollIntervalMs);
    const pollIntervalMs = Number.isFinite(pollRaw) && pollRaw > 0 ? pollRaw : fallbackPoll;
    const backoffRaw = b && b.pollErrorBackoffMs;
    const pollErrorBackoffMs = Array.isArray(backoffRaw)
      ? backoffRaw
          .map(function (x) {
            return Number(x);
          })
          .filter(function (n) {
            return Number.isFinite(n) && n > 0;
          })
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
      void runPollCycle();
    }, safe);
  }

  /** While EventSource is connected, skip poll timers (#276). */
  function schedulePollAfterMsUnlessSse(delayMs) {
    if (typeof EventSource !== 'undefined' && state.reviewSse && state.reviewSse.readyState === EventSource.OPEN) {
      return;
    }
    schedulePollAfterMs(delayMs);
  }

  function registerVisibilityForPoll() {
    if (state.visListenerRegistered) {
      return;
    }
    state.visListenerRegistered = true;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        void runPollCycle();
      }
    });
  }

  function startPollingIfNeeded() {
    if (state.pollTimer !== null) {
      return;
    }
    registerVisibilityForPoll();
    schedulePollAfterMs(getReviewQueueBoot().pollIntervalMs);
  }

  function stopReviewCandidatesStream() {
    if (state.reviewSse) {
      state.reviewSse.close();
      state.reviewSse = null;
    }
  }

  function resumePollingAfterStreamLoss() {
    stopReviewCandidatesStream();
    startPollingIfNeeded();
  }

  function clearReviewTabBadge() {
    const b = $('rc-tab-badge');
    if (b) {
      b.textContent = '';
      b.classList.add('hidden');
      b.setAttribute('aria-hidden', 'true');
    }
  }

  function setReviewTabBadge(totalPending) {
    const b = $('rc-tab-badge');
    if (!b || !(totalPending > 0)) {
      return;
    }
    b.textContent = totalPending > 99 ? '99+' : String(totalPending);
    b.classList.remove('hidden');
    b.setAttribute('aria-hidden', 'false');
  }

  function reviewOsNotifyAvailable() {
    if (!global.isSecureContext) {
      return false;
    }
    return typeof Notification === 'function';
  }

  function isReviewNotifyPromptDismissed() {
    try {
      return !!(global.localStorage && localStorage.getItem(ns.LS_NOTIFY_PROMPT_DISMISSED) === '1');
    } catch {
      return true;
    }
  }

  function dismissReviewNotifyPrompt() {
    try {
      if (global.localStorage) {
        localStorage.setItem(ns.LS_NOTIFY_PROMPT_DISMISSED, '1');
      }
    } catch {
      /* ignore */
    }
  }

  function syncReviewNotifyPromptUI() {
    const wrap = $('rc-notify-prompt');
    if (!wrap) {
      return;
    }
    if (!reviewOsNotifyAvailable()) {
      setHidden(wrap, true);
      return;
    }
    if (Notification.permission !== 'default') {
      setHidden(wrap, true);
      return;
    }
    if (isReviewNotifyPromptDismissed()) {
      setHidden(wrap, true);
      return;
    }
    setHidden(wrap, false);
  }

  function wireReviewNotifyPrompt() {
    if (state.notifyPromptWired) {
      return;
    }
    state.notifyPromptWired = true;
    const enable = $('rc-notify-enable-btn');
    const dismiss = $('rc-notify-dismiss-btn');
    if (enable) {
      enable.addEventListener('click', function () {
        void (async function () {
          try {
            await Notification.requestPermission();
          } catch {
            /* ignore */
          }
          syncReviewNotifyPromptUI();
        })();
      });
    }
    if (dismiss) {
      dismiss.addEventListener('click', function () {
        dismissReviewNotifyPrompt();
        syncReviewNotifyPromptUI();
      });
    }
  }

  function tryOsNotifyReviewQueueGrowth(delta) {
    if (!reviewOsNotifyAvailable()) {
      return;
    }
    if (Notification.permission !== 'granted') {
      return;
    }
    if (document.visibilityState !== 'hidden') {
      return;
    }
    const title = 'Memento — Review queue';
    const body =
      delta === 1
        ? 'The pending review queue has 1 new item.'
        : 'The pending review queue has ' + String(delta) + ' new items.';
    try {
      const n = new Notification(title, { body: body, tag: ns.OS_NOTIFY_TAG });
      n.onclick = function () {
        try {
          global.focus();
        } catch {
          /* ignore */
        }
        try {
          n.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* OS or browser blocked notification */
    }
  }

  function showNewCandidatesToast(delta, onReviewTab) {
    const t = $('rc-toast');
    if (!t) {
      return;
    }
    const msg =
      delta === 1
        ? '1 new review candidate (pending queue grew).'
        : String(delta) + ' new review candidates (pending queue grew).';
    t.textContent =
      msg + (onReviewTab ? ' List updated.' : ' Open Review Queue to refresh.');
    t.classList.remove('hidden');
    if (state.toastHideTimer) {
      clearTimeout(state.toastHideTimer);
    }
    state.toastHideTimer = setTimeout(function () {
      t.classList.add('hidden');
      t.textContent = '';
      state.toastHideTimer = null;
    }, 8000);
  }

  function scheduleAfterPollFailure(boot) {
    state.pollFailureStreak += 1;
    let delayMs = boot.pollIntervalMs;
    const steps = boot.pollErrorBackoffMs;
    if (steps.length > 0) {
      const idx = Math.min(state.pollFailureStreak - 1, steps.length - 1);
      delayMs = steps[idx];
    }
    schedulePollAfterMs(delayMs);
  }

  async function runPollCycle() {
    const boot = getReviewQueueBoot();
    const allowPollWhenHidden =
      reviewOsNotifyAvailable() && Notification.permission === 'granted';
    if (document.visibilityState === 'hidden' && !allowPollWhenHidden) {
      schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
      return;
    }
    if (state.lastPendingCount < 0) {
      schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
      return;
    }
    let res;
    let body;
    try {
      const r = await ns.fetchReviewCandidateListJson();
      res = r.res;
      body = r.body;
    } catch {
      scheduleAfterPollFailure(boot);
      return;
    }
    if (!res.ok) {
      scheduleAfterPollFailure(boot);
      return;
    }
    state.pollFailureStreak = 0;
    const candidates = (body && body.candidates) || [];
    const n = candidates.length;
    const prev = state.lastPendingCount;
    if (prev >= 0 && n > prev) {
      const delta = n - prev;
      const reviewPanel = $('tab-review-candidates');
      const onReview = !!(reviewPanel && reviewPanel.classList.contains('active'));
      showNewCandidatesToast(delta, onReview);
      tryOsNotifyReviewQueueGrowth(delta);
      if (!onReview) {
        setReviewTabBadge(n);
      }
      if (onReview) {
        ns.applyListSuccess(body);
        schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
        return;
      }
      state.lastPendingCount = n;
      schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
      return;
    }
    state.lastPendingCount = n;
    schedulePollAfterMsUnlessSse(boot.pollIntervalMs);
  }

  async function onReviewQueueSseChanged() {
    let res;
    let body;
    try {
      const r = await ns.fetchReviewCandidateListJson();
      res = r.res;
      body = r.body;
    } catch {
      resumePollingAfterStreamLoss();
      return;
    }
    if (!res.ok) {
      resumePollingAfterStreamLoss();
      return;
    }
    state.pollFailureStreak = 0;
    const reviewPanel = $('tab-review-candidates');
    const onReview = !!(reviewPanel && reviewPanel.classList.contains('active'));
    if (onReview) {
      ns.applyListSuccess(body);
      return;
    }
    const candidates = (body && body.candidates) || [];
    const n = candidates.length;
    const prev = state.lastPendingCount;
    if (prev >= 0 && n > prev) {
      showNewCandidatesToast(n - prev, false);
      setReviewTabBadge(n);
    }
    state.lastPendingCount = n;
  }

  function maybeStartReviewCandidatesEventSource() {
    if (typeof EventSource === 'undefined') {
      startPollingIfNeeded();
      return;
    }
    if (state.reviewSse) {
      return;
    }
    try {
      state.reviewSse = new EventSource(ns.STREAM_URL);
    } catch {
      state.reviewSse = null;
      startPollingIfNeeded();
      return;
    }
    state.reviewSse.addEventListener('open', function () {
      clearPollTimer();
      state.pollFailureStreak = 0;
    });
    state.reviewSse.addEventListener('changed', function () {
      void onReviewQueueSseChanged();
    });
    state.reviewSse.onerror = function () {
      resumePollingAfterStreamLoss();
    };
  }

  ns.getReviewQueueBoot = getReviewQueueBoot;
  ns.clearPollTimer = clearPollTimer;
  ns.schedulePollAfterMs = schedulePollAfterMs;
  ns.schedulePollAfterMsUnlessSse = schedulePollAfterMsUnlessSse;
  ns.startPollingIfNeeded = startPollingIfNeeded;
  ns.stopReviewCandidatesStream = stopReviewCandidatesStream;
  ns.resumePollingAfterStreamLoss = resumePollingAfterStreamLoss;
  ns.runPollCycle = runPollCycle;
  ns.maybeStartReviewCandidatesEventSource = maybeStartReviewCandidatesEventSource;
  ns.clearReviewTabBadge = clearReviewTabBadge;
  ns.setReviewTabBadge = setReviewTabBadge;
  ns.syncReviewNotifyPromptUI = syncReviewNotifyPromptUI;
  ns.wireReviewNotifyPrompt = wireReviewNotifyPrompt;
})(typeof window !== 'undefined' ? window : globalThis);
