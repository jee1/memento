/**
 * Ops status panel — read-only manual refresh (#1048).
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_OPS_STATUS_PANEL__ = global.__MEMENTO_OPS_STATUS_PANEL__ || {});

  // Korean UI strings (#1146). Code references S.* only; edit text here, not in the logic below.
  const S = {
    severity: {
      ok: '정상',
      warn: '주의',
      crit: '위험',
      info: '참고',
      unknown: '확인 불가',
    },
    trendImpact: function (days, failedDays) {
      return '최근 ' + days + '일 일별 배치 영향 시간 추이 — 실패가 있던 날 ' + failedDays + '일';
    },
    trendNetflow: function (samples, min, max) {
      return '최근 표본 ' + samples + '개의 순유입 추이 — 최소 ' + min + ', 최대 ' + max;
    },
  };


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

  const DAY_MS = 86400000;
  const SPARK_W = 90;
  const SPARK_H = 20;
  const ROW_KEYS = [
    'process-uptime', 'scheduler', 'scheduler-uptime', 'database', 'version',
    'batch-failed', 'batch-impact', 'batch-success', 'batch-last-failed', 'batch-now',
    'review-pending', 'review-netflow', 'embedding',
  ];
  // severity kind -> badge modifier. info/unknown share the hollow idle shape; the text tells them apart.
  const SEVERITY_BADGE = { ok: 'ok', warn: 'warn', crit: 'crit', info: 'idle', unknown: 'idle' };

  function isOk(section) {
    return Boolean(section) && section.status === 'ok';
  }

  /** #1146: one severity kind per row key: ok | warn | crit | info | unknown. */
  ns.rowSeverities = function (data, nowMs) {
    const d = data || {};
    const proc = d.process || {};
    const sched = d.scheduler || {};
    const batch = d.batchImpact || {};
    const review = d.review || {};
    const emb = d.embedding || {};
    const schedulerSev = !isOk(sched) ? 'unknown' : sched.running ? 'ok' : 'crit';
    let lastFailed = 'unknown';
    if (isOk(batch)) {
      if (!batch.lastFailedAt) {
        lastFailed = 'ok';
      } else {
        const t = Date.parse(String(batch.lastFailedAt));
        lastFailed = Number.isFinite(t) && nowMs - t <= DAY_MS ? 'crit' : 'warn';
      }
    }
    return {
      'process-uptime': isOk(proc) ? 'ok' : 'unknown',
      scheduler: schedulerSev,
      'scheduler-uptime': schedulerSev,
      database: proc.database === 'connected' ? 'ok' : 'crit',
      version: 'info',
      'batch-failed': !isOk(batch) ? 'unknown' : batch.failedRunCount > 0 ? 'warn' : 'ok',
      'batch-impact': !isOk(batch) ? 'unknown' : batch.durationMsSum > 0 ? 'warn' : 'ok',
      'batch-success': isOk(batch) ? 'info' : 'unknown',
      'batch-last-failed': lastFailed,
      'batch-now': isOk(sched) ? 'info' : 'unknown',
      'review-pending': isOk(review) ? 'info' : 'unknown',
      'review-netflow': !isOk(review) ? 'unknown' : review.netFlow1h > 0 ? 'warn' : 'ok',
      embedding: !isOk(emb) ? 'unknown' : emb.problemCount > 0 ? 'warn' : 'ok',
    };
  };

  /**
   * #1146: polyline points for a width x height box, or '' when there is no trend to draw
   * (fewer than 2 points or any non-finite value). The baseline always includes 0.
   */
  ns.sparklinePoints = function (values, width, height) {
    if (!Array.isArray(values) || values.length < 2) {
      return '';
    }
    for (let i = 0; i < values.length; i++) {
      if (typeof values[i] !== 'number' || !Number.isFinite(values[i])) {
        return '';
      }
    }
    const lo = Math.min(0, Math.min.apply(null, values));
    const hi = Math.max(0, Math.max.apply(null, values));
    const step = width / (values.length - 1);
    return values
      .map(function (v, i) {
        const y = hi === lo ? height / 2 : height - ((v - lo) / (hi - lo)) * height;
        return (Math.round(i * step * 100) / 100) + ',' + (Math.round(y * 100) / 100);
      })
      .join(' ');
  };

  function setSeverity(key, kind) {
    const badge = ns.$('ops-status-sev-' + key);
    if (badge) {
      badge.className = 'ops-row__sev m-badge m-badge--' + SEVERITY_BADGE[kind];
      badge.textContent = S.severity[kind];
    }
    const row = ns.$('ops-status-row-' + key);
    if (row) {
      row.setAttribute('data-severity', kind);
    }
    const link = ns.$('ops-status-link-' + key);
    if (link) {
      ns.setHidden(link, kind !== 'warn' && kind !== 'crit');
    }
  }

  function renderSparkline(key, values, label) {
    const host = ns.$('ops-status-trend-' + key);
    if (!host) {
      return;
    }
    host.textContent = '';
    const points = ns.sparklinePoints(values, SPARK_W, SPARK_H);
    if (!points) {
      return;
    }
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'm-sparkline');
    svg.setAttribute('viewBox', '0 0 ' + SPARK_W + ' ' + SPARK_H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    const line = document.createElementNS(svgNs, 'polyline');
    line.setAttribute('points', points);
    svg.appendChild(line);
    host.appendChild(svg);
  }

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
    return data && data.running ? '실행 중' : '중지';
  }

  function renderQueueNow(data) {
    const status = data && data.status;
    if (status === 'degraded' || status === 'unavailable') {
      return '—';
    }
    const runningJobs = typeof data.runningJobs === 'number' ? data.runningJobs : 0;
    const queueSize = typeof data.queueSize === 'number' ? data.queueSize : 0;
    return '실행 중 ' + runningJobs + '건 · 대기 ' + queueSize + '건';
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
      'ops-status-scheduler-uptime',
      formatText(data.scheduler && data.scheduler.uptimeHuman, data.scheduler && data.scheduler.status),
    );
    ns.setText(
      'ops-status-database',
      data.process && data.process.database === 'connected' ? '연결됨' : '연결 안 됨',
    );
    ns.setText('ops-status-version', formatText(data.process && data.process.version, 'ok'));

    const batch = data.batchImpact || {};
    ns.setText('ops-status-batch-failed', formatCount(batch.failedRunCount, batch.status));
    ns.setText('ops-status-batch-impact', formatText(batch.durationHuman, batch.status));
    ns.setText('ops-status-batch-success', formatCount(batch.successRunCount, batch.status));
    ns.setText('ops-status-batch-last-failed', formatIso(batch.lastFailedAt, batch.status));
    ns.setText('ops-status-batch-now', renderQueueNow(data.scheduler));

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

    const severities = ns.rowSeverities(data, Date.now());
    ROW_KEYS.forEach(function (key) {
      setSeverity(key, severities[key]);
    });

    const daily = Array.isArray(batch.dailyDurationMs) ? batch.dailyDurationMs : [];
    renderSparkline(
      'batch-impact',
      daily,
      S.trendImpact(daily.length, daily.filter(function (ms) { return ms > 0; }).length),
    );
    const flowHistory = Array.isArray(review.netFlow1hHistory) ? review.netFlow1hHistory : [];
    renderSparkline(
      'review-netflow',
      flowHistory,
      flowHistory.length ? S.trendNetflow(flowHistory.length, Math.min.apply(null, flowHistory), Math.max.apply(null, flowHistory)) : '',
    );
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
    ROW_KEYS.forEach(function (key) {
      const link = ns.$('ops-status-link-' + key);
      if (!link) {
        return;
      }
      link.addEventListener('click', function () {
        const tab = link.getAttribute('data-ops-goto');
        const tabs = global.__MEMENTO_DASHBOARD_TABS__;
        if (tab && tabs && typeof tabs.activateTab === 'function') {
          tabs.activateTab(tab);
        }
      });
    });
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
