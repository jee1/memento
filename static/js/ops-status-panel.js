/**
 * Ops status panel — read-only manual refresh (#1048).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_OPS_STATUS_PANEL__ = global.__MEMENTO_OPS_STATUS_PANEL__ || {});

  ns.STATUS_URL = '/admin/status';

  ns.state = ns.state || {
    wired: false,
    lastSnapshot: null,
    refreshGeneration: 0,
  };

  ns.$ = function (id) {
    return document.getElementById(id);
  };

  ns.setHidden = function (element, hidden) {
    if (!element) {
      return;
    }
    element.classList.toggle('hidden', hidden);
  };

  ns.setText = function (id, value) {
    const el = ns.$(id);
    if (el) {
      el.textContent = value;
    }
  };

  ns.setLoading = function (loading) {
    ns.setHidden(ns.$('ops-status-loading'), !loading);
  };

  ns.setError = function (message) {
    const el = ns.$('ops-status-error');
    if (!el) {
      return;
    }
    if (message) {
      el.textContent = message;
      ns.setHidden(el, false);
    } else {
      el.textContent = '';
      ns.setHidden(el, true);
    }
  };

  function statusLabel(status) {
    if (status === 'ok') {
      return '정상';
    }
    if (status === 'degraded') {
      return '일부 불가';
    }
    return '확인 불가';
  }

  function formatCount(value, status) {
    if (status === 'degraded' || status === 'unavailable') {
      return '—';
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '—';
    }
    return String(value);
  }

  function formatText(value, status) {
    if (status === 'degraded' || status === 'unavailable') {
      return '—';
    }
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    return String(value);
  }

  function formatIso(value, status) {
    if (status === 'degraded' || status === 'unavailable') {
      return '—';
    }
    if (!value) {
      return '—';
    }
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function renderScheduler(data) {
    const status = data && data.status;
    if (status === 'degraded' || status === 'unavailable') {
      return '—';
    }
    const running = data && data.running;
    const uptimeHuman = data && data.uptimeHuman ? data.uptimeHuman : '—';
    const runningJobs = typeof data.runningJobs === 'number' ? data.runningJobs : 0;
    const queueSize = typeof data.queueSize === 'number' ? data.queueSize : 0;
    const runLabel = running ? '실행 중' : '정지';
    return runLabel + ' · ' + uptimeHuman + ' · 작업 ' + runningJobs + ' · 큐 ' + queueSize;
  }

  function renderEmbedding(data) {
    const status = data && data.status;
    if (status === 'degraded' || status === 'unavailable') {
      return '—';
    }
    const provider = data && data.provider ? data.provider : '—';
    const count = typeof data.problemCount === 'number' ? data.problemCount : 0;
    return provider + ' · 문제 ' + count + '건';
  }

  ns.render = function (data) {
    if (!data) {
      return;
    }

    ns.setText('ops-status-process-uptime', formatText(data.process && data.process.uptimeHuman, 'ok'));
    ns.setText('ops-status-scheduler', renderScheduler(data.scheduler));
    ns.setText(
      'ops-status-database',
      data.process && data.process.database === 'connected' ? '연결됨' : '연결 안 됨',
    );
    ns.setText('ops-status-version', formatText(data.process && data.process.version, 'ok'));

    const batch = data.batchImpact || {};
    ns.setText('ops-status-batch-failed', formatCount(batch.failedRunCount, batch.status));
    ns.setText('ops-status-batch-impact', formatText(batch.durationHuman, batch.status));
    ns.setText('ops-status-batch-success', formatCount(batch.successRunCount, batch.status));
    ns.setText('ops-status-batch-now', formatIso(batch.lastFailedAt, batch.status));

    const review = data.review || {};
    ns.setText('ops-status-review-pending', formatCount(review.pendingTotal, review.status));
    ns.setText('ops-status-review-netflow', formatCount(review.netFlow1h, review.status));

    ns.setText('ops-status-embedding', renderEmbedding(data.embedding));

    const systemCard = ns.$('ops-status-card-system');
    const batchCard = ns.$('ops-status-card-batch');
    const flowCard = ns.$('ops-status-card-flow');
    if (systemCard) {
      systemCard.setAttribute('data-status', statusLabel(data.process && data.process.status));
    }
    if (batchCard) {
      batchCard.setAttribute('data-status', statusLabel(batch.status));
    }
    if (flowCard) {
      const reviewStatus = review.status;
      const embeddingStatus = data.embedding && data.embedding.status;
      const flowStatus =
        reviewStatus === 'degraded' || embeddingStatus === 'degraded'
          ? '일부 불가'
          : reviewStatus === 'unavailable' || embeddingStatus === 'unavailable'
            ? '확인 불가'
            : '정상';
      flowCard.setAttribute('data-status', flowStatus);
    }
  };

  ns.refresh = async function () {
    const generation = ++ns.state.refreshGeneration;
    ns.setLoading(true);
    try {
      const response = await global.fetch(ns.STATUS_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' for ' + ns.STATUS_URL);
      }
      const data = await response.json();
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      ns.state.lastSnapshot = data;
      ns.setError('');
      ns.render(data);
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      const message = err && err.message ? String(err.message) : '운영 상태 새로고침 실패';
      ns.setError(message);
    } finally {
      if (generation === ns.state.refreshGeneration) {
        ns.setLoading(false);
      }
    }
  };

  function wirePanel() {
    const btn = ns.$('ops-status-refresh-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        void ns.refresh();
      });
    }
  }

  function initOpsStatusPanel() {
    if (!ns.state.wired) {
      ns.state.wired = true;
      wirePanel();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOpsStatusPanel);
  } else {
    initOpsStatusPanel();
  }
})(typeof window !== 'undefined' ? window : globalThis);
