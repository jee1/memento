/**
 * Review candidates panel — shared constants, DOM helpers, and mutable state (#252+).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_REVIEW_CANDIDATES_PANEL__ =
    global.__MEMENTO_REVIEW_CANDIDATES_PANEL__ || {});

  ns.LIST_URL = '/admin/memory/review-candidates?status=pending';
  ns.STREAM_URL = '/admin/memory/review-candidates/stream';
  ns.METRICS_URL = '/admin/memory/review-candidates/metrics?history_limit=24';
  ns.BATCH_RUN_HISTORY_URL = '/admin/batch/run-history?limit=50';
  ns.REASON_TABLE_MAX = 120;

  ns.LS_NOTIFY_PROMPT_DISMISSED = 'memento_review_queue_notify_prompt_dismissed_v1';
  ns.OS_NOTIFY_TAG = 'memento-review-queue-pending-grow';

  ns.state = ns.state || {
    wired: false,
    loadedOnce: false,
    selectedRow: null,
    previewMemoryId: '',
    previewGeneration: 0,
    pollTimer: null,
    visListenerRegistered: false,
    lastPendingCount: -1,
    lastListFingerprint: '',
    toastHideTimer: null,
    actionInFlight: false,
    pollFailureStreak: 0,
    reviewSse: null,
    notifyPromptWired: false,
    selectedCandidateIds: new Set(),
    currentCandidateIds: [],
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setHidden(el, hidden) {
    if (!el) {
      return;
    }
    el.classList.toggle('hidden', hidden);
  }

  function clearStatus() {
    const line = $('rc-status-line');
    if (line) {
      line.textContent = '';
    }
  }

  function truncateReason(text) {
    if (!text) {
      return '';
    }
    if (text.length <= ns.REASON_TABLE_MAX) {
      return text;
    }
    return text.slice(0, ns.REASON_TABLE_MAX) + '…';
  }

  function formatDue(iso) {
    if (!iso) {
      return '';
    }
    const d = new Date(String(iso));
    if (Number.isNaN(d.getTime())) {
      return String(iso);
    }
    return d.toLocaleString();
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function previewUrl(memoryId) {
    return '/admin/memory/items/' + encodeURIComponent(memoryId);
  }

  function reviewCandidatePostUrl(id, action) {
    return '/admin/memory/review-candidates/' + encodeURIComponent(id) + '/' + action;
  }

  function adminFetch() {
    return typeof mementoAdminFetch === 'function' ? mementoAdminFetch : fetch;
  }

  function buildReviewListFingerprint(candidates) {
    return candidates
      .map(function (candidate) {
        return [
          String(candidate.id ?? ''),
          String(candidate.priority ?? ''),
          String(candidate.status ?? ''),
          String(candidate.due_at ?? ''),
        ].join(':');
      })
      .join('\n');
  }

  ns.$ = $;
  ns.setHidden = setHidden;
  ns.clearStatus = clearStatus;
  ns.truncateReason = truncateReason;
  ns.formatDue = formatDue;
  ns.escapeHtml = escapeHtml;
  ns.escapeAttr = escapeAttr;
  ns.previewUrl = previewUrl;
  ns.reviewCandidatePostUrl = reviewCandidatePostUrl;
  ns.adminFetch = adminFetch;
  ns.buildReviewListFingerprint = buildReviewListFingerprint;
})(typeof window !== 'undefined' ? window : globalThis);
