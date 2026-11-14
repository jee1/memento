/**
 * Review candidates panel — shared constants, DOM helpers, and mutable state (#252+).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_REVIEW_CANDIDATES_PANEL__ =
    global.__MEMENTO_REVIEW_CANDIDATES_PANEL__ || {});

  ns.LIST_URL = '/admin/memory/review-candidates?status=pending&page_size=25&page=1';
  ns.STREAM_URL = '/admin/memory/review-candidates/stream';
  ns.METRICS_URL = '/admin/memory/review-candidates/metrics?history_limit=24';
  ns.BATCH_RUN_HISTORY_URL = '/admin/batch/run-history?limit=50';
  ns.REASON_TABLE_MAX = 120;
  ns.ID_DISPLAY_MAX = 14;

  ns.LS_NOTIFY_PROMPT_DISMISSED = 'memento_review_queue_notify_prompt_dismissed_v1';
  ns.OS_NOTIFY_TAG = 'memento-review-queue-pending-grow';

  ns.STATUS_LABELS = {
    pending: '대기',
    reviewed: '보존됨',
    dismissed: '무시됨',
    expired: '만료',
  };

  ns.ANCHOR_LABELS = {
    last_recalled_at: '마지막 recall',
    created_at_fallback: '생성일(대체)',
  };

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

  function truncateId(id) {
    const raw = String(id || '');
    if (!raw) {
      return '';
    }
    if (raw.length <= ns.ID_DISPLAY_MAX) {
      return raw;
    }
    return raw.slice(0, ns.ID_DISPLAY_MAX) + '…';
  }

  function formatStatus(status) {
    const key = String(status || '');
    return ns.STATUS_LABELS[key] || key;
  }

  function formatReasonDisplay(reason) {
    const raw = String(reason || '');
    if (!raw) {
      return '';
    }
    const m = /^eligible:\s*importance=([0-9.]+)>=([0-9.]+),\s*stale=(\d+)d>=(\d+)d,\s*anchor=([A-Za-z0-9_]+)/.exec(
      raw,
    );
    if (!m) {
      return raw;
    }
    const importance = Number(m[1]);
    const threshold = Number(m[2]);
    const staleDays = m[3];
    const anchorKey = m[5];
    const importancePart =
      importance >= threshold
        ? '중요도 ' + importance.toFixed(2) + ', 기준 이상'
        : '중요도 ' + importance.toFixed(2) + ', 기준 미달';
    const anchorPart = ns.ANCHOR_LABELS[anchorKey] || anchorKey;
    return importancePart + ' · 미사용 ' + staleDays + '일 · ' + anchorPart;
  }

  function formatDue(iso) {
    if (!iso) {
      return '';
    }
    const d = new Date(String(iso));
    if (Number.isNaN(d.getTime())) {
      return String(iso);
    }
    const now = new Date();
    const startToday = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const startDue = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((startDue - startToday) / 86400000);
    if (days > 0) {
      return days + '일 남음';
    }
    if (days === 0) {
      return '오늘';
    }
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + day;
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
  ns.truncateId = truncateId;
  ns.formatStatus = formatStatus;
  ns.formatReasonDisplay = formatReasonDisplay;
  ns.formatDue = formatDue;
  ns.escapeHtml = escapeHtml;
  ns.escapeAttr = escapeAttr;
  ns.previewUrl = previewUrl;
  ns.reviewCandidatePostUrl = reviewCandidatePostUrl;
  ns.adminFetch = adminFetch;
  ns.buildReviewListFingerprint = buildReviewListFingerprint;
})(typeof window !== 'undefined' ? window : globalThis);
