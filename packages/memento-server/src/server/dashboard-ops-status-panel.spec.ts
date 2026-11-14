/**
 * Dashboard Ops status panel — zones first screen (#1699).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { LLM_USAGE_FEATURES } from '@memento/core/shared/services/llm-usage/llm-usage-types.js';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const opsStatusPanelJs = readFileSync(resolve(root, 'static/js/ops-status-panel.js'), 'utf8');
const tabsPanelsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs-panels.js'), 'utf8');

/** Static zone keys emitted by admin-ops-summary-zones (minus llm_* rows). */
const STATIC_ZONE_KEYS = [
  'process_database',
  'scheduler_running',
  'batch_failed_run_count',
  'paused_job_count',
  'job_interval_overdue_count',
  'server_version',
  'schema_version',
  'auth_denied_count',
  'migration_backup',
  'migration_backup_file_count',
  'db_size_mb',
  'wal_size_mb',
  'injection_item_filtered_events',
  'item_filter_kept',
  'item_filter_dropped',
  'item_filter_empty',
  'injection_empty',
  'feedback_positive_count',
  'feedback_negative_count',
  'search_query_count',
  'search_empty_rejected',
  'search_empty_no_result',
  'gate_drift_alert',
  'relation_extraction_failures',
  'review_pending_total',
  'review_last_human_decision_at',
  'review_net_flow_1h',
  'supersede_pending_count',
  'embedding_problem_count',
] as const;

function createClassList() {
  const classes = new Set<string>();
  return {
    add: (n: string) => classes.add(n),
    remove: (n: string) => classes.delete(n),
    toggle: (n: string, force?: boolean) => {
      if (force === true) classes.add(n);
      else if (force === false) classes.delete(n);
      else if (classes.has(n)) classes.delete(n);
      else classes.add(n);
    },
    contains: (n: string) => classes.has(n),
  };
}

type HarnessOptions = {
  fetchImpl?: (url: string) => Promise<unknown>;
  fetchReject?: Error;
  responseOk?: boolean;
  responseStatus?: number;
};

function createElementMock(tag: string) {
  const element: Record<string, unknown> = {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    type: '',
    textContent: '',
    attributes: {} as Record<string, string>,
    children: [] as unknown[],
    classList: createClassList(),
    style: {},
    setAttribute(name: string, value: string) {
      (this as { attributes: Record<string, string> }).attributes[name] = value;
      if (name === 'id') {
        (this as { id: string }).id = value;
      }
    },
    getAttribute(name: string) {
      return (this as { attributes: Record<string, string> }).attributes[name] ?? null;
    },
    appendChild(c: unknown) {
      (this as { children: unknown[] }).children.push(c);
      const parts = (this as { children: Array<{ textContent?: string }> }).children.map(
        (kid) => kid.textContent ?? '',
      );
      (this as { textContent: string }).textContent = parts.join('');
      return c;
    },
    removeChild(c: unknown) {
      const kids = (this as { children: unknown[] }).children;
      const idx = kids.indexOf(c);
      if (idx >= 0) {
        kids.splice(idx, 1);
      }
      const parts = (this as { children: Array<{ textContent?: string }> }).children.map(
        (kid) => kid.textContent ?? '',
      );
      (this as { textContent: string }).textContent = parts.join('');
      return c;
    },
    addEventListener: vi.fn(),
  };
  Object.defineProperty(element, 'firstChild', {
    get() {
      return (this as { children: unknown[] }).children[0] ?? null;
    },
  });
  return element;
}

function createOpsStatusHarness(options: HarnessOptions = {}) {
  const elements: Record<string, any> = {};
  const buttonHandlers: Record<string, Array<() => void>> = {};
  const zonesHost = createElementMock('div');
  zonesHost.id = 'ops-status-zones';
  elements['ops-status-zones'] = zonesHost;

  function el(id: string, extras: Record<string, unknown> = {}) {
    const element: Record<string, unknown> = {
      id,
      _textContent: '',
      className: '',
      classList: createClassList(),
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      get textContent() {
        return (this as { _textContent: string })._textContent;
      },
      set textContent(value: string) {
        (this as { _textContent: string })._textContent = value;
      },
      setAttribute(name: string, value: string) {
        (this as { attributes: Record<string, string> }).attributes[name] = value;
      },
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (!buttonHandlers[id]) {
          buttonHandlers[id] = [];
        }
        if (event === 'click') {
          buttonHandlers[id].push(handler);
        }
      }),
      ...extras,
    };
    elements[id] = element;
    return element;
  }

  el('ops-status-refresh-btn');
  el('ops-status-loading');
  const termList = createElementMock('ul');
  termList.id = 'ops-status-term-list';
  elements['ops-status-term-list'] = termList;

  const fetchCalls: string[] = [];
  const sandbox: Record<string, unknown> = {
    console,
    document: {
      readyState: 'complete',
      addEventListener: vi.fn(),
      getElementById: (id: string) => elements[id] ?? null,
      createElement: (tag: string) => createElementMock(tag),
      createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
    },
    fetch: vi.fn(async (url: string) => {
      fetchCalls.push(String(url));
      if (options.fetchReject) {
        throw options.fetchReject;
      }
      const ok = options.responseOk !== false;
      const status = options.responseStatus ?? (ok ? 200 : 500);
      if (options.fetchImpl) {
        const data = await options.fetchImpl(url);
        return {
          ok,
          status,
          json: async () => data,
        };
      }
      return {
        ok,
        status,
        json: async () => ({}),
      };
    }),
    __MEMENTO_OPS_STATUS_PANEL__: undefined,
  };

  vm.createContext(sandbox);
  vm.runInContext(opsStatusPanelJs, sandbox);

  const ns = sandbox.__MEMENTO_OPS_STATUS_PANEL__ as {
    SUMMARY_URL: string;
    refresh: () => Promise<void>;
    renderZones: (zones: unknown, options?: unknown) => void;
    labelForKey: (key: string) => string;
    formatValue: (item: unknown) => string;
    formatWindowPeriod: (period: string | null | undefined) => string;
    descriptionForKey: (key: string) => string;
    isKnownLabelKey: (key: string) => boolean;
    ZONE_KEY_LABELS: Record<string, string>;
    renderTermHelp: () => void;
  };

  return {
    ns,
    elements,
    fetchCalls,
    zonesHost,
    clickRefresh() {
      for (const handler of buttonHandlers['ops-status-refresh-btn'] || []) {
        handler();
      }
    },
  };
}

function window7d() {
  return {
    period: '7d' as const,
    since: '2026-11-06T00:00:00.000Z',
    until: '2026-11-13T00:00:00.000Z',
  };
}

function sampleZones() {
  const w = window7d();
  return {
    system_ok: [
      {
        key: 'process_database',
        value: 'connected',
        unit: null,
        severity: 'ok',
        as_of: '2026-11-13T00:00:00.000Z',
        window: { ...w, period: '30d' },
      },
      {
        key: 'scheduler_running',
        value: true,
        unit: null,
        severity: 'ok',
        as_of: '2026-11-13T00:00:00.000Z',
        window: { ...w, period: '30d' },
      },
    ],
    doing_work: [
      {
        key: 'item_filter_kept',
        value: 3,
        unit: 'count',
        severity: null,
        as_of: null,
        window: w,
      },
      {
        key: 'injection_empty',
        value: 0,
        unit: 'count',
        severity: null,
        as_of: null,
        window: w,
      },
      {
        key: 'llm_relation_extraction_attempts',
        value: 10,
        unit: 'count',
        severity: null,
        as_of: '2026-11-13T00:00:00.000Z',
        window: w,
      },
    ],
    needs_action: [
      {
        key: 'review_pending_total',
        value: 500,
        unit: 'count',
        severity: 'warn',
        as_of: '2026-06-16T00:00:00.000Z',
        window: { ...w, period: '30d' },
      },
      {
        key: 'embedding_problem_count',
        value: 0,
        unit: 'count',
        severity: 'ok',
        as_of: '2026-11-13T00:00:00.000Z',
        window: { ...w, period: '30d' },
      },
    ],
  };
}

describe('dashboard ops status panel (#1699)', () => {
  it('includes the ops status tab button and panel in dashboard.html', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-ops-status"');
    expect(dashboardHtml).toContain('id="tab-ops-status"');
    expect(dashboardHtml).toContain('data-tab="ops-status"');
    expect(dashboardHtml).toContain('id="ops-status-zones"');
  });

  it('makes ops-status the default active tab in markup', () => {
    expect(dashboardHtml).toMatch(
      /id="dashboard-tab-ops-status"[^>]*class="[^"]*\bactive\b/,
    );
    expect(dashboardHtml).toMatch(/id="tab-ops-status"[^>]*class="[^"]*\bactive\b/);
    expect(dashboardHtml).not.toMatch(/id="dashboard-tab-anchor"[^>]*class="[^"]*\bactive\b/);
    expect(dashboardHtml).not.toContain('id="ops-strip"');
    expect(dashboardHtml).not.toContain('ops-summary-body');
  });

  it('places the ops status tab before review in the Ops group', () => {
    const opsGroupStart = dashboardHtml.indexOf('aria-hidden="true">운영</span>');
    const opsGroupEnd = dashboardHtml.indexOf('</div>', opsGroupStart);
    const opsGroup = dashboardHtml.slice(opsGroupStart, opsGroupEnd);
    const opsStatusIndex = opsGroup.indexOf('data-tab="ops-status"');
    const reviewIndex = opsGroup.indexOf('data-tab="review"');
    expect(opsStatusIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeGreaterThan(opsStatusIndex);
  });

  it('lists ops-status before review in TAB_PANELS', () => {
    const opsIndex = tabsPanelsJs.indexOf("{ name: 'ops-status'");
    const reviewIndex = tabsPanelsJs.indexOf("{ name: 'review'");
    expect(opsIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeGreaterThan(opsIndex);
  });

  it('fetches /admin/ops/summary?period=7d and renders zone titles and windows', async () => {
    const harness = createOpsStatusHarness({
      fetchImpl: async () => ({
        window: window7d(),
        zones: sampleZones(),
        questions: {},
      }),
    });

    await harness.ns.refresh();

    expect(harness.fetchCalls).toEqual(['/admin/ops/summary?period=7d']);
    expect(harness.ns.SUMMARY_URL).toBe('/admin/ops/summary?period=7d');

    const cards = harness.zonesHost.children as Array<{
      attributes: Record<string, string>;
      children: Array<{ textContent?: string; children?: unknown[] }>;
    }>;
    expect(cards).toHaveLength(3);
    expect(cards[0].attributes['data-zone']).toBe('system_ok');
    expect(cards[1].attributes['data-zone']).toBe('doing_work');
    expect(cards[2].attributes['data-zone']).toBe('needs_action');
    expect(cards[0].children[0].textContent).toBe('정상인가');
    expect(cards[1].children[0].textContent).toBe('제 일을 하고 있나');
    expect(cards[2].children[0].textContent).toBe('손댈 것');

    const systemRows = (cards[0].children[1] as { children: Array<{ attributes: Record<string, string>; children: Array<{ className?: string; textContent?: string }> }> }).children;
    expect(systemRows[0].attributes['data-key']).toBe('process_database');
    expect(systemRows[0].attributes['data-severity']).toBe('ok');
    const windowText = systemRows[0].children.find((c) => c.className === 'ops-row__window');
    expect(windowText?.textContent).toBe('최근 30일');

    const doingRows = (cards[1].children[1] as { children: Array<{ attributes: Record<string, string>; children: Array<{ className?: string; textContent?: string }> }> }).children;
    expect(doingRows[0].attributes['data-severity']).toBeUndefined();
    const nullSevBadge = doingRows[0].children.find((c) => c.className === 'ops-row__sev');
    expect(nullSevBadge?.textContent ?? '').toBe('');

    const actionRows = (cards[2].children[1] as { children: Array<{ attributes: Record<string, string>; children: Array<{ className?: string; textContent?: string }> }> }).children;
    const pendingValue = actionRows[0].children.find((c) => c.className === 'ops-row__value');
    expect(pendingValue?.textContent).toBe('500');
  });

  it('renders unknown zone items without panel code changes (generic zones)', async () => {
    const zones = sampleZones();
    zones.system_ok.push({
      key: 'custom_probe_signal',
      value: 42,
      unit: 'count',
      severity: null,
      as_of: null,
      window: window7d(),
    });
    const harness = createOpsStatusHarness({
      fetchImpl: async () => ({ zones, window: window7d() }),
    });
    await harness.ns.refresh();
    const cards = harness.zonesHost.children as Array<{
      children: Array<{ children?: Array<{ attributes: Record<string, string>; children: Array<{ className?: string; textContent?: string }> }> }>;
    }>;
    const rows = cards[0].children[1].children as Array<{
      attributes: Record<string, string>;
      children: Array<{ className?: string; textContent?: string }>;
    }>;
    const probe = rows.find((r) => r.attributes['data-key'] === 'custom_probe_signal');
    expect(probe).toBeTruthy();
    const label = probe?.children.find((c) => c.className === 'ops-row__label');
    const value = probe?.children.find((c) => c.className === 'ops-row__value');
    expect(label?.textContent).toBe('미등록 항목');
    expect(value?.textContent).toBe('42');
  });

  it('paints fetch failure as crit with a visible reason', async () => {
    const harness = createOpsStatusHarness({
      fetchReject: new Error('network down'),
    });
    await harness.ns.refresh();
    const banner = harness.zonesHost.children[0] as {
      id: string;
      attributes: Record<string, string>;
      children: Array<{ className?: string; textContent?: string }>;
    };
    expect(banner.id).toBe('ops-status-fetch-fail');
    expect(banner.attributes['data-severity']).toBe('crit');
    expect(banner.children.some((c) => c.className === 'm-badge m-badge--crit')).toBe(true);
    expect(banner.children.some((c) => String(c.textContent).includes('network down'))).toBe(true);
  });

  it('paints HTTP 5xx as fetch failure', async () => {
    const harness = createOpsStatusHarness({
      responseOk: false,
      responseStatus: 503,
      fetchImpl: async () => ({ error: 'unavailable' }),
    });
    await harness.ns.refresh();
    const banner = harness.zonesHost.children[0] as {
      attributes: Record<string, string>;
      children: Array<{ textContent?: string }>;
    };
    expect(banner.attributes['data-severity']).toBe('crit');
    expect(banner.children.some((c) => String(c.textContent).includes('HTTP 503'))).toBe(true);
  });

  it('labels LLM feature metrics with Korean names and metric suffixes (#1716)', () => {
    const harness = createOpsStatusHarness();
    expect(harness.ns.labelForKey('llm_cluster_judge_attempts')).toBe('클러스터 판정 / 시도');
    expect(harness.ns.labelForKey('llm_agent_chat_attempts')).toBe('에이전트 채팅 / 시도');
    expect(harness.ns.labelForKey('llm_directive_recall_other_failures')).toBe('지침 회상 / 기타 실패');
    expect(harness.ns.labelForKey('llm_supersede_judge_rate_limited')).toBe('대체 판정 / 호출 한도');
    expect(harness.ns.labelForKey('llm_unknown_feature_attempts')).toBe('미등록 작업 / 시도');
  });

  it('covers every server zone key in the label table with Korean text (#1716)', () => {
    const harness = createOpsStatusHarness();
    const englishToken = /\b(attempts|other_failures|rate_limited)\b|_/;
    const missing: string[] = [];
    for (const key of STATIC_ZONE_KEYS) {
      expect(harness.ns.isKnownLabelKey(key), key).toBe(true);
      const label = harness.ns.labelForKey(key);
      if (label === key || englishToken.test(label)) {
        missing.push(key + '=' + label);
      }
    }
    for (const feature of LLM_USAGE_FEATURES) {
      for (const metric of ['attempts', 'other_failures', 'rate_limited'] as const) {
        const key = `llm_${feature}_${metric}`;
        expect(harness.ns.isKnownLabelKey(key), key).toBe(true);
        const label = harness.ns.labelForKey(key);
        if (englishToken.test(label) || label.includes(feature)) {
          missing.push(key + '=' + label);
        }
      }
    }
    expect(missing, `label table gaps: ${missing.join(', ')}`).toEqual([]);
    expect(Object.keys(harness.ns.ZONE_KEY_LABELS).sort()).toEqual([...STATIC_ZONE_KEYS].sort());
  });

  it('formats window periods in Korean and attaches descriptions (#1716)', async () => {
    const harness = createOpsStatusHarness();
    expect(harness.ns.formatWindowPeriod('7d')).toBe('최근 7일');
    expect(harness.ns.formatWindowPeriod('30d')).toBe('최근 30일');
    expect(harness.ns.formatWindowPeriod('24h')).toBe('최근 24시간');
    expect(harness.ns.formatWindowPeriod(null)).toBe('현재');
    expect(harness.ns.descriptionForKey('item_filter_kept')).toContain('점수 기준');
    expect(dashboardHtml).toContain('id="ops-status-term-list"');

    const zones = sampleZones();
    const harness2 = createOpsStatusHarness({
      fetchImpl: async () => ({ zones, window: window7d() }),
    });
    await harness2.ns.refresh();
    const termHost = harness2.elements['ops-status-term-list'] as {
      children: Array<{ textContent?: string }>;
    };
    expect(termHost.children.length).toBeGreaterThan(0);
    expect(termHost.children.some((c) => String(c.textContent).includes('항목 필터 남김'))).toBe(true);

    const cards = harness2.zonesHost.children as Array<{
      children: Array<{
        children?: Array<{
          attributes: Record<string, string>;
          children: Array<{ className?: string; attributes?: Record<string, string> }>;
        }>;
      }>;
    }>;
    const doingRows = cards[1].children[1].children as Array<{
      attributes: Record<string, string>;
      children: Array<{ className?: string; attributes?: Record<string, string> }>;
    }>;
    const kept = doingRows.find((r) => r.attributes['data-key'] === 'item_filter_kept');
    expect(kept).toBeTruthy();
    const label = kept?.children.find((c) => c.className === 'ops-row__label');
    expect(label?.attributes?.title).toContain('점수 기준');
    const windowEl = kept?.children.find((c) => c.className === 'ops-row__window') as
      | { textContent?: string }
      | undefined;
    expect(windowEl?.textContent).toBe('최근 7일');
  });

  it('shows labels, MB unit and current window for the #1704 disk signals', async () => {
    const zones = sampleZones();
    zones.system_ok.push(
      { key: 'migration_backup', value: '2026-11-01T00:00:00.000Z', unit: null, severity: null, as_of: null, window: null },
      { key: 'migration_backup_file_count', value: 3, unit: 'count', severity: null, as_of: null, window: null },
      { key: 'db_size_mb', value: 12.5, unit: 'MB', severity: null, as_of: null, window: null },
      { key: 'wal_size_mb', value: null, unit: 'MB', severity: null, as_of: null, window: null },
    );
    const harness = createOpsStatusHarness({ fetchImpl: async () => ({ zones, window: window7d() }) });
    await harness.ns.refresh();

    const cards = harness.zonesHost.children as Array<{
      children: Array<{ children?: Array<{ attributes: Record<string, string>; children: Array<{ className?: string; textContent?: string }> }> }>;
    }>;
    const rowOf = (key: string) => cards[0].children[1].children!.find((r) => r.attributes['data-key'] === key)!;
    const text = (key: string, cls: string) => rowOf(key).children.find((c) => c.className === cls)?.textContent;

    expect(text('migration_backup', 'ops-row__label')).toBe('마이그레이션 백업');
    expect(text('migration_backup', 'ops-row__value')).toContain('2026');
    expect(text('migration_backup_file_count', 'ops-row__label')).toBe('마이그레이션 백업 파일 수');
    expect(text('migration_backup_file_count', 'ops-row__value')).toBe('3');
    expect(text('db_size_mb', 'ops-row__label')).toBe('DB 크기');
    expect(text('db_size_mb', 'ops-row__value')).toBe('12.5 MB');
    expect(text('wal_size_mb', 'ops-row__label')).toBe('WAL 크기');
    expect(text('wal_size_mb', 'ops-row__value')).toBe('—');
    expect(text('db_size_mb', 'ops-row__window')).toBe('현재');
    expect(rowOf('db_size_mb').attributes['data-severity']).toBeUndefined();
  });

  it('paints a 200 response without zones as fetch failure', async () => {
    const harness = createOpsStatusHarness({ fetchImpl: async () => ({ window: window7d() }) });
    await harness.ns.refresh();
    const banner = harness.zonesHost.children[0] as {
      attributes: Record<string, string>;
      children: Array<{ textContent?: string }>;
    };
    expect(banner.attributes['data-severity']).toBe('crit');
    expect(banner.children.some((c) => String(c.textContent).includes('zones'))).toBe(true);
  });

  it('has a label for every fixed zone key the server emits', () => {
    const serverSource = readFileSync(
      resolve(root, 'packages/memento-server/src/server/routes/admin/admin-ops-summary-zones.ts'),
      'utf8',
    );
    const keys = [...serverSource.matchAll(/\bitem\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(20);
    const harness = createOpsStatusHarness();
    const unlabeled = keys.filter((key) => harness.ns.labelForKey(key) === key);
    expect(unlabeled).toEqual([]);
  });

  it('does not embed developer measured/unmeasured strings or client severity thresholds', () => {
    expect(opsStatusPanelJs).not.toContain('measured');
    expect(opsStatusPanelJs).not.toContain('unmeasured');
    expect(opsStatusPanelJs).not.toContain('failed events');
    expect(opsStatusPanelJs).not.toContain('queries ');
    expect(opsStatusPanelJs).not.toContain('rowSeverities');
    expect(opsStatusPanelJs).not.toContain('DAY_MS');
    expect(opsStatusPanelJs).not.toContain('innerHTML');
    expect(opsStatusPanelJs).toContain("'/admin/ops/summary?period=7d'");
  });
});
