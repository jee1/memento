/**
 * Jobs panel display formatters (#1724). Dedicated to this panel — do not share with review.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_JOBS_PANEL__;
  if (!ns) {
    return;
  }

  /** Korean label first; English key stays for log search (title / secondary). */
  ns.JOB_TYPE_LABELS = {
    cleanup: '망각 정책 배치',
    monitoring: '성능 모니터링',
    healthcheck: '상태 점검',
    log_rotation: '로그·백업 보존',
    quality_measurement_batch: '기억 품질 측정',
    meta_memory_introspection: '메타 기억 점검',
    memory_review_candidates: '검토 대기열 후보 선정',
    sleep_consolidation_batch: '수면 통합',
    telemetry_cleanup_batch: '텔레메트리 정리',
    forgetting_event_cleanup_batch: '망각 이벤트 정리',
    job_run_cleanup_batch: '실행 이력 정리',
    anchor_auto_refresh: '앵커 자동 갱신',
    embedding_reconciliation: '임베딩 정합',
    supersede_candidate_scan: '대체 후보 스캔',
    rejection_gate_drift_check: '기각 게이트 드리프트 점검',
    reflexion_healthcheck: '리플렉션 상태 점검',
    reflexion_cleanup: '리플렉션 정리',
    lock_monitor: 'DB 락 모니터',
    wal_checkpoint: 'WAL 체크포인트',
  };

  ns.TRIGGER_LABELS = {
    schedule: '예약',
    manual: '수동',
    retry: '재시도',
  };

  ns.isKnownJobTypeLabel = function (key) {
    return Object.prototype.hasOwnProperty.call(ns.JOB_TYPE_LABELS, String(key || ''));
  };

  ns.formatJobTypeLabel = function (jobType) {
    const key = String(jobType || '');
    if (!key) {
      return '';
    }
    return ns.JOB_TYPE_LABELS[key] || key;
  };

  /** Interval for operators: 「매일」, 「5분마다」, … (#1724). */
  ns.formatIntervalHuman = function (intervalMs) {
    if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return '—';
    }
    const day = 86400000;
    const hour = 3600000;
    const minute = 60000;
    if (intervalMs % day === 0) {
      const n = intervalMs / day;
      return n === 1 ? '매일' : n + '일마다';
    }
    if (intervalMs % hour === 0) {
      const n = intervalMs / hour;
      return n === 1 ? '1시간마다' : n + '시간마다';
    }
    if (intervalMs % minute === 0) {
      const n = intervalMs / minute;
      return n === 1 ? '1분마다' : n + '분마다';
    }
    if (intervalMs >= 1000 && intervalMs % 1000 === 0) {
      return intervalMs / 1000 + '초마다';
    }
    return intervalMs + 'ms마다';
  };

  ns.formatDurationHuman = function (durationMs) {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
      return '—';
    }
    if (durationMs < 1000) {
      return durationMs + 'ms';
    }
    if (durationMs < 60000) {
      return (durationMs / 1000).toFixed(1).replace(/\.0$/, '') + '초';
    }
    if (durationMs < 3600000) {
      const m = Math.floor(durationMs / 60000);
      const s = Math.round((durationMs % 60000) / 1000);
      return s > 0 ? m + '분 ' + s + '초' : m + '분';
    }
    const h = Math.floor(durationMs / 3600000);
    const m = Math.round((durationMs % 3600000) / 60000);
    return m > 0 ? h + '시간 ' + m + '분' : h + '시간';
  };

  ns.formatTrigger = function (trigger) {
    const key = String(trigger || '');
    if (!key) {
      return '—';
    }
    return ns.TRIGGER_LABELS[key] || key;
  };

  ns.formatQueueSummary = function (queue) {
    const q = queue || {};
    const running = Array.isArray(q.runningNames)
      ? q.runningNames.map(ns.formatJobTypeLabel).join(', ')
      : '';
    const queued = Array.isArray(q.queuedNames)
      ? q.queuedNames.map(ns.formatJobTypeLabel).join(', ')
      : '';
    return (
      '대기열 ' +
      ns.formatNumber(q.size) +
      '건 · 실행 중 ' +
      ns.formatNumber(q.runningCount) +
      '건 · 실행=[' +
      (running || '—') +
      '] · 대기=[' +
      (queued || '—') +
      ']'
    );
  };

  /** Korea-local wall clock for status lines and cells (#1724). */
  ns.formatKoDateTime = function (value) {
    if (!value) {
      return '—';
    }
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  };

  /** Compact table cell: 「11. 14. 오후 4:23」 — fits schedule/timeline cols (#1724 review). */
  ns.formatKoDateTimeTable = function (value) {
    if (!value) {
      return '—';
    }
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    const parts = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);
    const get = (type) => {
      const p = parts.find((x) => x.type === type);
      return p ? p.value : '';
    };
    const dayPeriod = get('dayPeriod');
    return get('month') + '. ' + get('day') + '. ' + dayPeriod + ' ' + get('hour') + ':' + get('minute');
  };
})(typeof window !== 'undefined' ? window : globalThis);
