/**
 * Ops status panel — first-screen zones from /admin/ops/summary (#1699).
 * Renders zones generically; severity colors come only from the server.
 */
(function (global) {
  'use strict';

  const ns = (global.__MEMENTO_OPS_STATUS_PANEL__ = global.__MEMENTO_OPS_STATUS_PANEL__ || {});
  const doc = global.document;

  const S = {
    severity: { ok: '정상', warn: '주의', crit: '위험' },
    fetchFail: '요청 실패',
    windowNow: '현재',
    zoneTitles: {
      system_ok: '정상인가',
      doing_work: '제 일을 하고 있나',
      needs_action: '손댈 것',
    },
  };

  const ZONE_ORDER = ['system_ok', 'doing_work', 'needs_action'];

  const LABELS = {
    process_database: '프로세스/DB',
    scheduler_running: '스케줄러',
    batch_failed_run_count: '배치 실패',
    paused_job_count: '일시정지된 잡',
    job_interval_overdue_count: '주기 초과 잡',
    server_version: '서버 버전',
    schema_version: '마이그레이션 버전',
    auth_denied_count: '인증 실패',
    migration_backup: '마이그레이션 백업',
    migration_backup_file_count: '마이그레이션 백업 파일 수',
    db_size_mb: 'DB 크기',
    wal_size_mb: 'WAL 크기',
    injection_item_filtered_events: '주입(항목 필터) 횟수',
    item_filter_kept: '항목 필터 남김',
    item_filter_dropped: '항목 필터 탈락',
    item_filter_empty: '항목 필터 전부 걸러짐',
    injection_empty: '빈 주입',
    feedback_positive_count: '피드백 긍정',
    feedback_negative_count: '피드백 부정',
    search_query_count: '검색 요청',
    search_empty_rejected: '검색 빈 결과(거부)',
    search_empty_no_result: '검색 빈 결과(결과 없음)',
    gate_drift_alert: '게이트 드리프트',
    relation_extraction_failures: '관계 추출 실패',
    review_pending_total: '검토 대기',
    review_last_human_decision_at: '마지막 사람 결정',
    review_net_flow_1h: '검토 순유입 (1h)',
    supersede_pending_count: '대체 후보 대기',
    embedding_problem_count: '임베딩 문제',
  };

  const LINKS = {
    batch_failed_run_count: { tab: 'jobs', label: '배치 작업 보기' },
    paused_job_count: { tab: 'jobs', label: '배치 작업 보기' },
    job_interval_overdue_count: { tab: 'jobs', label: '배치 작업 보기' },
    review_pending_total: { tab: 'review', label: '검토 대기열 보기' },
    review_last_human_decision_at: { tab: 'review', label: '검토 대기열 보기' },
    review_net_flow_1h: { tab: 'review', label: '검토 대기열 보기' },
    supersede_pending_count: { tab: 'supersede', label: '대체 후보 보기' },
    embedding_problem_count: { tab: 'embedding', label: '임베딩 상태 보기' },
  };

  ns.SUMMARY_URL = '/admin/ops/summary?period=7d';
  ns.state = ns.state || {
    wired: false,
    lastSnapshot: null,
    refreshGeneration: 0,
  };

  ns.$ = function (id) {
    return doc.getElementById(id);
  };

  ns.setHidden = function (element, hidden) {
    if (!element) {
      return;
    }
    element.classList.toggle('hidden', hidden);
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

  ns.labelForKey = function (key) {
    if (LABELS[key]) {
      return LABELS[key];
    }
    const llm = /^llm_(.+)_(attempts|other_failures|rate_limited)$/.exec(String(key));
    if (llm) {
      return llm[1] + ' / ' + llm[2];
    }
    return String(key);
  };

  function formatRelativeAndAbsolute(iso) {
    const date = new Date(String(iso));
    if (Number.isNaN(date.getTime())) {
      return String(iso);
    }
    const abs = date.toLocaleString();
    const diffMs = Date.now() - date.getTime();
    if (diffMs < 0) {
      return abs;
    }
    const days = Math.floor(diffMs / 86400000);
    let rel;
    if (days < 1) {
      const hours = Math.floor(diffMs / 3600000);
      rel = hours < 1 ? '방금' : hours + '시간 전';
    } else if (days < 30) {
      rel = days + '일 전';
    } else {
      rel = Math.floor(days / 30) + '개월 전';
    }
    return rel + ' / ' + abs;
  }

  ns.formatValue = function (item) {
    const key = item && item.key;
    const value = item && item.value;
    if (value === null || value === undefined) {
      return '—';
    }
    if (key === 'process_database') {
      if (value === 'connected') {
        return '연결됨';
      }
      if (value === 'disconnected') {
        return '연결 안 됨';
      }
      return String(value);
    }
    if (key === 'scheduler_running') {
      return value ? '실행 중' : '중지';
    }
    if (typeof value === 'boolean') {
      return value ? '예' : '아니오';
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return formatRelativeAndAbsolute(value);
    }
    if (item.unit === 'MB' && typeof value === 'number') {
      return value + ' MB';
    }
    return String(value);
  };

  ns.buildRow = function (item) {
    const li = doc.createElement('li');
    li.className = 'ops-row';
    li.setAttribute('data-key', item.key);

    const sev = item.severity;
    const badge = doc.createElement('span');
    if (sev === 'ok' || sev === 'warn' || sev === 'crit') {
      li.setAttribute('data-severity', sev);
      badge.className = 'ops-row__sev m-badge m-badge--' + sev;
      badge.textContent = S.severity[sev];
    } else {
      badge.className = 'ops-row__sev';
      badge.setAttribute('aria-hidden', 'true');
    }
    li.appendChild(badge);

    const label = doc.createElement('span');
    label.className = 'ops-row__label';
    label.textContent = ns.labelForKey(item.key);
    li.appendChild(label);

    const value = doc.createElement('span');
    value.className = 'ops-row__value';
    value.textContent = ns.formatValue(item);
    li.appendChild(value);

    const windowEl = doc.createElement('span');
    windowEl.className = 'ops-row__window';
    windowEl.textContent = item.window && item.window.period ? String(item.window.period) : S.windowNow;
    li.appendChild(windowEl);

    const linkSpec = LINKS[item.key];
    if (linkSpec && (sev === 'warn' || sev === 'crit')) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'm-button m-button--ghost ops-row__link';
      btn.setAttribute('data-ops-goto', linkSpec.tab);
      btn.textContent = linkSpec.label;
      btn.addEventListener('click', function () {
        const tabs = global.__MEMENTO_DASHBOARD_TABS__;
        if (tabs && typeof tabs.activateTab === 'function') {
          tabs.activateTab(linkSpec.tab);
        }
      });
      li.appendChild(btn);
    }

    return li;
  };

  ns.renderZones = function (zones, options) {
    const host = ns.$('ops-status-zones');
    if (!host) {
      return;
    }
    while (host.firstChild) {
      host.removeChild(host.firstChild);
    }

    if (options && options.fetchFailed) {
      const banner = doc.createElement('div');
      banner.id = 'ops-status-fetch-fail';
      banner.className = 'ops-status-fetch-fail';
      banner.setAttribute('data-severity', 'crit');
      banner.setAttribute('role', 'alert');
      const badge = doc.createElement('span');
      badge.className = 'm-badge m-badge--crit';
      badge.textContent = S.severity.crit;
      const text = doc.createElement('span');
      text.textContent = (options && options.message) || S.fetchFail;
      banner.appendChild(badge);
      banner.appendChild(text);
      host.appendChild(banner);
      return;
    }

    if (!zones) {
      return;
    }

    ZONE_ORDER.forEach(function (zoneKey) {
      const items = Array.isArray(zones[zoneKey]) ? zones[zoneKey] : [];
      const card = doc.createElement('section');
      card.className = 'ops-status-card m-panel';
      card.setAttribute('data-zone', zoneKey);
      card.setAttribute('aria-labelledby', 'ops-zone-heading-' + zoneKey);

      const heading = doc.createElement('h3');
      heading.id = 'ops-zone-heading-' + zoneKey;
      heading.textContent = S.zoneTitles[zoneKey] || zoneKey;

      const list = doc.createElement('ul');
      list.className = 'ops-status-rows';
      for (let i = 0; i < items.length; i++) {
        list.appendChild(ns.buildRow(items[i]));
      }

      card.appendChild(heading);
      card.appendChild(list);
      host.appendChild(card);
    });
  };

  ns.refresh = async function () {
    const generation = ++ns.state.refreshGeneration;
    ns.setLoading(true);
    try {
      const response = await global.fetch(ns.SUMMARY_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' for ' + ns.SUMMARY_URL);
      }
      const data = await response.json();
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      if (!data || typeof data.zones !== 'object' || data.zones === null) {
        throw new Error('응답에 zones 가 없습니다');
      }
      ns.state.lastSnapshot = data;
      ns.setError('');
      ns.renderZones(data.zones);
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      const message = err && err.message ? String(err.message) : '운영 상태 새로고침 실패';
      ns.setError(message);
      ns.renderZones(null, { fetchFailed: true, message: message });
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

  global.initOpsStatusPanel = function () {
    initOpsStatusPanel();
    void ns.refresh();
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', initOpsStatusPanel);
  } else {
    initOpsStatusPanel();
  }
})(typeof window !== 'undefined' ? window : globalThis);
