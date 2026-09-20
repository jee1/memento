import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import {
  buildReviewQueueBootInjectionHtml,
  REVIEW_QUEUE_DASHBOARD_BOOT_ELEMENT_ID,
  REVIEW_QUEUE_DASHBOARD_BOOT_MARKER,
  type ReviewQueueDashboardBoot,
} from './review-queue-dashboard-boot.js';

// 서버가 실제로 내보내는 데이터 블록에서 JSON 본문만 꺼낸다.
// 주입 형식과 클라이언트 파서가 어긋나면 여기서 깨진다 (#875).
function bootDataBlockText(boot: ReviewQueueDashboardBoot): string {
  return buildReviewQueueBootInjectionHtml(boot)
    .replace(/^<script[^>]*>/, '')
    .replace(/<\/script>$/, '');
}

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const DASHBOARD_TABS_SCRIPTS = [
  'dashboard-tabs-panels.js',
  'dashboard-tabs-init.js',
  'dashboard-tabs.js',
] as const;

const tabsJs = DASHBOARD_TABS_SCRIPTS.map((name) =>
  readFileSync(resolve(root, 'static/js', name), 'utf8'),
).join('\n');

const PANEL_COMPANION_SCRIPTS = [
  'review-candidates-panel-shared.js',
  'review-candidates-panel-filters.js',
  'review-candidates-panel-render-preview.js',
  'review-candidates-panel-render-actions.js',
  'review-candidates-panel-render-list.js',
  'review-candidates-panel-render.js',
  'review-candidates-panel-poll-boot.js',
  'review-candidates-panel-poll-config.js',
  'review-candidates-panel-poll-badge.js',
  'review-candidates-panel-poll-prompt.js',
  'review-candidates-panel-poll-toast.js',
  'review-candidates-panel-poll-notify-os.js',
  'review-candidates-panel-poll-snapshot.js',
  'review-candidates-panel-poll-fetch.js',
  'review-candidates-panel-poll-cycle.js',
  'review-candidates-panel-poll-stream.js',
  'review-candidates-panel-poll.js',
  'review-candidates-panel-health-render.js',
  'review-candidates-panel-health-fetch.js',
  'review-candidates-panel-health.js',
  'review-candidates-panel-bulk.js',
  'review-candidates-panel.js',
] as const;

function readReviewCandidatesPanelSources(): string {
  return PANEL_COMPANION_SCRIPTS.map((name) =>
    readFileSync(resolve(root, 'static/js', name), 'utf8'),
  ).join('\n');
}

const panelJs = readReviewCandidatesPanelSources();
const sharedJs = readFileSync(
  resolve(root, 'static/js/review-candidates-panel-shared.js'),
  'utf8',
);
const previewJs = readFileSync(
  resolve(root, 'static/js/review-candidates-panel-render-preview.js'),
  'utf8',
);
const listJs = readFileSync(
  resolve(root, 'static/js/review-candidates-panel-render-list.js'),
  'utf8',
);
const POLL_COMPANION_SCRIPTS = [
  'review-candidates-panel-poll-boot.js',
  'review-candidates-panel-poll-config.js',
  'review-candidates-panel-poll-badge.js',
  'review-candidates-panel-poll-prompt.js',
  'review-candidates-panel-poll-toast.js',
  'review-candidates-panel-poll-notify-os.js',
  'review-candidates-panel-poll-snapshot.js',
  'review-candidates-panel-poll-fetch.js',
  'review-candidates-panel-poll-cycle.js',
  'review-candidates-panel-poll-stream.js',
  'review-candidates-panel-poll.js',
] as const;
const pollJs = POLL_COMPANION_SCRIPTS.map((name) =>
  readFileSync(resolve(root, 'static/js', name), 'utf8'),
).join('\n');

function createPollHarness(
  options: { activeReviewTab?: boolean; boot?: ReviewQueueDashboardBoot; omitBoot?: boolean } = {}
) {
  const elements: Record<string, any> = {};
  const timers: Array<{ delayMs: number; callback: () => void }> = [];
  const state = {
    lastPendingCount: 2,
    lastListFingerprint: '',
    pollFailureStreak: 0,
    pollTimer: null,
    reviewSse: null,
    toastHideTimer: null,
    visListenerRegistered: false
  };

  function createElement(active = false) {
    const classes = new Set(active ? ['active'] : []);
    return {
      textContent: '',
      attributes: {} as Record<string, string>,
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name)
      },
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      }
    };
  }

  elements['tab-review-candidates'] = createElement(options.activeReviewTab);
  elements['rc-toast'] = createElement();
  elements['rc-tab-badge'] = createElement();
  const boot = options.boot ?? { pollIntervalMs: 60_000, pollErrorBackoffMs: [1_000, 5_000] };
  if (!options.omitBoot) {
    elements[REVIEW_QUEUE_DASHBOARD_BOOT_ELEMENT_ID] = { textContent: bootDataBlockText(boot) };
  }

  const sandbox: Record<string, any> = {
    console,
    document: {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      getElementById: (id: string) => elements[id] ?? null
    },
    setTimeout: (callback: () => void, delayMs: number) => {
      timers.push({ callback, delayMs });
      return timers.length;
    },
    clearTimeout: vi.fn(),
    __MEMENTO_REVIEW_CANDIDATES_PANEL__: {
      $: (id: string) => elements[id] ?? null,
      setHidden: vi.fn(),
      state,
      OS_NOTIFY_TAG: 'memento-review-queue',
      LS_NOTIFY_PROMPT_DISMISSED: 'memento-review-notify-dismissed',
      buildReviewListFingerprint: (candidates: Array<Record<string, unknown>>) =>
        candidates
          .map((candidate) =>
            [candidate.id, candidate.priority, candidate.status, candidate.due_at]
              .map((value) => String(value ?? ''))
              .join(':'),
          )
          .sort()
          .join('\n'),
      fetchReviewCandidateListJson: vi.fn(),
      applyListSuccess: vi.fn()
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(pollJs, context, { filename: 'review-candidates-panel-poll.js' });

  return {
    elements,
    ns: sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__,
    state,
    timers
  };
}

describe('dashboard review candidates panel (#252, #253)', () => {
  it('lets checkbox Space toggle normally without activating the row (#883)', () => {
    const handlers: Record<string, (event: any) => void> = {};
    const tbody = {
      dataset: {},
      textContent: '',
      addEventListener: (name: string, handler: (event: any) => void) => {
        handlers[name] = handler;
      },
      querySelectorAll: () => [],
    };
    const sandbox: Record<string, any> = {
      document: { createElement: vi.fn() },
      __MEMENTO_REVIEW_CANDIDATES_PANEL__: {
        state: { selectedCandidateIds: new Set(), currentCandidateIds: [] },
        $: (id: string) => (id === 'rc-table' ? { querySelector: () => tbody } : {}),
        setHidden: vi.fn(),
        onRowActivate: vi.fn(),
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInContext(listJs, vm.createContext(sandbox), {
      filename: 'review-candidates-panel-render-list.js',
    });
    sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__.renderTable([]);
    const preventDefault = vi.fn();
    handlers.keydown({
      key: ' ',
      preventDefault,
      target: { closest: (selector: string) => selector === 'input[type="checkbox"]' },
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__.onRowActivate).not.toHaveBeenCalled();
  });

  it('does not apply a stale A preview after selecting B (#883)', async () => {
    const deferred = new Map<string, { resolve: (value: unknown) => void }>();
    const responseFor = (memoryId: string) =>
      new Promise((resolve) => deferred.set(memoryId, { resolve }));
    const classList = () => {
      const names = new Set<string>();
      return {
        add: (name: string) => names.add(name),
        remove: (name: string) => names.delete(name),
        contains: (name: string) => names.has(name),
        toggle: (name: string, on: boolean) => (on ? names.add(name) : names.delete(name)),
      };
    };
    const element = () => ({ textContent: '', disabled: false, classList: classList() });
    const elements = Object.fromEntries(
      [
        'rc-preview-memory-status',
        'rc-preview-content',
        'rc-preview-placeholder',
        'rc-preview-detail',
        'rc-preview-priority',
        'rc-preview-reason',
        'rc-preview-due',
        'rc-preview-mid',
        'rc-btn-review',
        'rc-btn-dismiss',
      ].map((id) => [id, element()]),
    ) as Record<string, any>;
    const state = { selectedRow: null as any, previewMemoryId: '', previewGeneration: 0, actionInFlight: false };
    const sandbox: Record<string, any> = {
      __MEMENTO_REVIEW_CANDIDATES_PANEL__: {
        state,
        $: (id: string) => elements[id],
        setHidden: (el: any, hidden: boolean) => el.classList.toggle('hidden', hidden),
        formatDue: (value: string) => value,
        previewUrl: (memoryId: string) => '/memory/' + memoryId,
        adminFetch: () => (url: string) => responseFor(url.slice('/memory/'.length)),
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInContext(previewJs, vm.createContext(sandbox), {
      filename: 'review-candidates-panel-render-preview.js',
    });
    const row = (candidateId: string, memoryId: string) => ({
      dataset: { candidateId, memoryId, priority: '1', reason: '', due: '' },
      classList: classList(),
      setAttribute: vi.fn(),
    });
    const a = row('a', 'memory-a');
    const b = row('b', 'memory-b');
    const ns = sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__;
    ns.onRowActivate(a);
    ns.onRowActivate(b);

    deferred.get('memory-b')!.resolve({
      ok: true,
      json: async () => ({ memory: { content: 'B preview' } }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    deferred.get('memory-a')!.resolve({
      ok: true,
      json: async () => ({ memory: { content: 'A preview' } }),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(state.selectedRow).toBe(b);
    expect(elements['rc-preview-mid'].textContent).toBe('memory-b');
    expect(elements['rc-preview-content'].textContent).toBe('B preview');
    expect(elements['rc-btn-review'].disabled).toBe(false);
    expect(elements['rc-btn-dismiss'].disabled).toBe(false);
  });

  it('treats a candidate order change as a distinct list fingerprint (#883)', () => {
    const sandbox: Record<string, any> = {
      document: { getElementById: () => null },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInContext(sharedJs, vm.createContext(sandbox), {
      filename: 'review-candidates-panel-shared.js',
    });
    const fingerprint = sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__.buildReviewListFingerprint;
    const aThenB = fingerprint([
      { id: 'a', priority: 1, status: 'pending', due_at: '' },
      { id: 'b', priority: 2, status: 'pending', due_at: '' },
    ]);
    const bThenA = fingerprint([
      { id: 'b', priority: 2, status: 'pending', due_at: '' },
      { id: 'a', priority: 1, status: 'pending', due_at: '' },
    ]);

    expect(aThenB).not.toBe(bThenA);
  });

  it('guards preview application and fingerprints review lists (#883)', () => {
    expect(panelJs).toContain('previewGeneration: 0');
    expect(panelJs).toContain('lastListFingerprint:');
    expect(panelJs).toContain('buildReviewListFingerprint');
    expect(panelJs).toContain('generation !== state.previewGeneration');
    expect(panelJs).toContain('state.selectedRow.dataset.candidateId !== candidateId');
    expect(panelJs).toContain("ev.target.closest('.rc-cell-select')");
  });

  it('dashboard.html includes review tab, panel, and script', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-review"');
    expect(dashboardHtml).toContain('data-tab="review"');
    expect(dashboardHtml).toContain('id="tab-review-candidates"');
    expect(dashboardHtml).toContain('/static/js/review-candidates-panel.js');
    for (const name of PANEL_COMPANION_SCRIPTS) {
      expect(dashboardHtml).toContain(`/static/js/${name}`);
    }
    expect(dashboardHtml).toContain(REVIEW_QUEUE_DASHBOARD_BOOT_MARKER);
    expect(dashboardHtml).toContain('id="rc-refresh-btn"');
    expect(dashboardHtml).toContain('class="rc-intro"');
    expect(dashboardHtml).toContain('class="rc-howto"');
    expect(dashboardHtml).toContain('id="rc-health-panel"');
    expect(dashboardHtml).toContain('id="rc-preview-aside"');
    expect(dashboardHtml).toContain('review-candidates-body');
  });

  it('dashboard-tabs.js uses m-tab selectors and review branch', () => {
    expect(tabsJs).toContain('.m-tab-bar');
    expect(tabsJs).toContain('.m-tab-btn');
    expect(tabsJs).not.toContain(".querySelectorAll('.tab-btn')");
    expect(tabsJs).toContain("'tab-review-candidates'");
    expect(tabsJs).toContain('initReviewCandidatesPanel');
  });

  it('review-candidates-panel.js targets pending list and admin memory preview', () => {
    expect(panelJs).toContain('buildListUrl');
    expect(panelJs).toContain('page_size');
    expect(panelJs).toContain('/admin/memory/review-candidates/metrics');
    expect(panelJs).toContain('/admin/memory/items/');
    expect(panelJs).toContain('initReviewCandidatesPanel');
  });

  it('review-candidates-panel.js POST review/dismiss paths and dashboard preview actions (#254)', () => {
    expect(panelJs).toContain('/admin/memory/review-candidates/');
    expect(panelJs).toContain('encodeURIComponent');
    expect(panelJs).toContain("postCandidateAction('review')");
    expect(panelJs).toContain("postCandidateAction('dismiss')");
    expect(dashboardHtml).toContain('id="rc-preview-actions"');
    expect(dashboardHtml).toContain('id="rc-btn-review"');
    expect(dashboardHtml).toContain('id="rc-btn-dismiss"');
  });

  it('supports selecting visible candidates and bulk dismiss/expire (#519)', () => {
    expect(dashboardHtml).toContain('id="rc-select-all"');
    expect(dashboardHtml).toContain('id="rc-selected-count"');
    expect(dashboardHtml).toContain('id="rc-bulk-dismiss-btn"');
    expect(dashboardHtml).toContain('id="rc-bulk-expire-btn"');
    expect(panelJs).toContain('/admin/memory/review-candidates/bulk-dismiss');
    expect(panelJs).toContain('/admin/memory/review-candidates/bulk-expire');
    expect(panelJs).toContain('selectedCandidateIds');
    expect(panelJs).toContain('JSON.stringify({ ids: ids })');
    expect(panelJs).toContain('await ns.loadList()');
  });
});

describe('dashboard review queue poll notify (#255)', () => {
  it('dashboard.html includes toast and tab badge placeholders', () => {
    expect(dashboardHtml).toContain('id="rc-toast"');
    expect(dashboardHtml).toContain('id="rc-tab-badge"');
  });

  it('review-candidates-panel.js includes polling helpers (#255, #274)', () => {
    expect(panelJs).toContain('getReviewQueueBoot');
    expect(panelJs).toContain(REVIEW_QUEUE_DASHBOARD_BOOT_ELEMENT_ID);
    expect(panelJs).toContain('runPollCycle');
    expect(panelJs).toContain('startPollingIfNeeded');
  });

  it('#875: 부트 값이 JSON 데이터 블록을 거쳐 폴링 설정까지 전달된다', () => {
    const { ns } = createPollHarness({
      boot: { pollIntervalMs: 45_000, pollErrorBackoffMs: [20_000, 90_000] }
    });

    expect(ns.getReviewQueueBoot()).toEqual({
      pollIntervalMs: 45_000,
      pollErrorBackoffMs: [20_000, 90_000]
    });
  });

  it('#875: 데이터 블록이 없으면 기본값으로 떨어진다', () => {
    const { ns } = createPollHarness({ omitBoot: true });

    expect(ns.getReviewQueueBoot()).toEqual({ pollIntervalMs: 60_000, pollErrorBackoffMs: [] });
  });
});

describe('dashboard review queue SSE (#276)', () => {
  it('review-candidates-panel.js wires EventSource stream URL and fallback helpers', () => {
    expect(panelJs).toContain('/admin/memory/review-candidates/stream');
    expect(panelJs).toContain('EventSource');
    expect(panelJs).toContain('maybeStartReviewCandidatesEventSource');
    expect(panelJs).toContain('resumePollingAfterStreamLoss');
    expect(panelJs).toContain('schedulePollAfterMsUnlessSse');
  });
});

describe('dashboard review queue poll behavior', () => {
  it('shows a toast and tab badge when the queue grows off the review tab', async () => {
    const harness = createPollHarness({ activeReviewTab: false });
    harness.ns.fetchReviewCandidateListJson.mockResolvedValue({
      res: { ok: true },
      body: { candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }
    });

    await harness.ns.runPollCycle();

    expect(harness.elements['rc-toast'].textContent).toContain('2건의 검토 후보가 늘었습니다');
    expect(harness.elements['rc-toast'].textContent).toContain('검토 대기열을 열어 새로고침하세요.');
    expect(harness.elements['rc-tab-badge'].textContent).toBe('4');
    expect(harness.elements['rc-tab-badge'].attributes['aria-hidden']).toBe('false');
    expect(harness.ns.applyListSuccess).not.toHaveBeenCalled();
    expect(harness.state.lastPendingCount).toBe(4);
    expect(harness.timers.at(-1)?.delayMs).toBe(60_000);
  });

  it('applies list results immediately when the active review tab poll grows', async () => {
    const harness = createPollHarness({ activeReviewTab: true });
    const body = { candidates: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    harness.ns.fetchReviewCandidateListJson.mockResolvedValue({
      res: { ok: true },
      body
    });

    await harness.ns.runPollCycle();

    expect(harness.elements['rc-toast'].textContent).toContain('검토 후보가 1건 늘었습니다');
    expect(harness.elements['rc-toast'].textContent).toContain('목록을 갱신했습니다.');
    expect(harness.ns.applyListSuccess).toHaveBeenCalledWith(body);
    expect(harness.elements['rc-tab-badge'].textContent).toBe('');
    expect(harness.timers.at(-1)?.delayMs).toBe(60_000);
  });

  it('applies same-count list changes when the active review tab fingerprint differs', async () => {
    const harness = createPollHarness({ activeReviewTab: true });
    harness.state.lastListFingerprint = 'a:1:pending:';
    const body = {
      candidates: [
        { id: 'a', priority: 1, status: 'pending', due_at: '' },
        { id: 'b', priority: 2, status: 'pending', due_at: '' },
      ],
    };
    harness.ns.fetchReviewCandidateListJson.mockResolvedValue({
      res: { ok: true },
      body,
    });

    await harness.ns.runPollCycle();

    expect(harness.ns.applyListSuccess).toHaveBeenCalledWith(body);
    expect(harness.state.lastPendingCount).toBe(2);
  });
});

/**
 * #897 PR2: 검토 대기열 정보 구조·미리보기 스크롤·Refresh 선택 유지.
 */
describe('#897 review queue structure and refresh selection', () => {
  function classList() {
    const names = new Set<string>();
    return {
      add: (name: string) => names.add(name),
      remove: (name: string) => names.delete(name),
      contains: (name: string) => names.has(name),
      toggle: (name: string, on: boolean) => (on ? names.add(name) : names.delete(name)),
    };
  }

  function makeCheckbox(candidateId: string) {
    return {
      checked: false,
      getAttribute: (name: string) => (name === 'data-candidate-select' ? candidateId : null),
    };
  }

  function makeTr() {
    const el: any = {
      dataset: {} as Record<string, string>,
      className: '',
      classList: classList(),
      setAttribute: vi.fn(),
      _checkbox: null as ReturnType<typeof makeCheckbox> | null,
    };
    Object.defineProperty(el, 'innerHTML', {
      set(html: string) {
        const match = html.match(/data-candidate-select="([^"]+)"/);
        if (match) {
          el._checkbox = makeCheckbox(match[1]!);
        }
      },
      get: () => '',
    });
    el.querySelectorAll = (sel: string) => {
      if (sel === '[data-candidate-select]' && el._checkbox) {
        return [el._checkbox];
      }
      return [];
    };
    return el;
  }

  function buildListPreviewHarness() {
    const rows: any[] = [];
    const tbody = {
      dataset: {} as Record<string, string>,
      textContent: '',
      appendChild(tr: any) {
        rows.push(tr);
      },
      querySelectorAll(sel: string) {
        if (sel === '[data-candidate-select]') {
          return rows.map((r) => r._checkbox).filter(Boolean);
        }
        if (sel === 'tr[data-candidate-id]') {
          return rows;
        }
        return [];
      },
      addEventListener: vi.fn(),
    };

    const element = () => ({
      textContent: '',
      classList: classList(),
      scrollTop: 0,
      disabled: false,
    });

    const elements: Record<string, any> = {};
    for (const id of [
      'rc-table-wrap',
      'rc-loading',
      'rc-empty',
      'rc-status-line',
      'rc-preview-placeholder',
      'rc-preview-detail',
      'rc-preview-memory-status',
      'rc-preview-content',
      'rc-preview-aside',
      'rc-preview-priority',
      'rc-preview-reason',
      'rc-preview-due',
      'rc-preview-mid',
      'rc-btn-review',
      'rc-btn-dismiss',
      'rc-filter-importance',
      'rc-filter-unused-days',
      'rc-filter-memory-type',
      'rc-filter-reason',
      'rc-filter-page-size',
    ]) {
      elements[id] = element();
    }
    elements['rc-filter-page-size'].value = '25';
    elements['rc-table'] = { querySelector: () => tbody };

    const state = {
      selectedRow: null as any,
      previewMemoryId: '',
      previewGeneration: 0,
      actionInFlight: false,
      selectedCandidateIds: new Set<string>(),
      currentCandidateIds: [] as string[],
      lastPendingCount: -1,
      lastListFingerprint: '',
      pollFailureStreak: 0,
      listFilters: {
        importance_min: '',
        unused_days_min: '',
        memory_type: '',
        reason_contains: '',
      },
      listPage: 1,
      listPageSize: 25,
      lastListQueryKey: '',
    };

    const adminFetchSpy = vi.fn();

    const sandbox: Record<string, any> = {
      console,
      document: {
        createElement: (tag: string) => (tag === 'tr' ? makeTr() : {}),
        getElementById: (id: string) => elements[id] ?? null,
      },
      __MEMENTO_REVIEW_CANDIDATES_PANEL__: {
        state,
        $: (id: string) => elements[id] ?? null,
        setHidden: (el: any, hidden: boolean) => el?.classList?.toggle('hidden', hidden),
        escapeHtml: (s: string) => s,
        escapeAttr: (s: string) => s,
        truncateReason: (s: string) => s,
        formatDue: (v: string) => v,
        LIST_URL: '/admin/memory/review-candidates?status=pending',
        adminFetch: () => adminFetchSpy,
        showError: vi.fn(),
        clearStatus: vi.fn(),
        buildReviewListFingerprint: (list: Array<Record<string, unknown>>) =>
          list.map((c) => String(c.id)).join(','),
        previewUrl: (memoryId: string) => '/memory/' + memoryId,
        maybeStartReviewCandidatesEventSource: vi.fn(),
        loadHealthMetrics: vi.fn(),
        loadBatchRunHistory: vi.fn(),
        syncBulkControls: vi.fn(),
        wireBulkTableSelection: vi.fn(),
        resetBulkSelection: vi.fn(),
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const context = vm.createContext(sandbox);
    const filtersJs = readFileSync(
      resolve(root, 'static/js/review-candidates-panel-filters.js'),
      'utf8',
    );
    vm.runInContext(filtersJs, context, {
      filename: 'review-candidates-panel-filters.js',
    });
    vm.runInContext(previewJs, context, {
      filename: 'review-candidates-panel-render-preview.js',
    });
    vm.runInContext(listJs, context, {
      filename: 'review-candidates-panel-render-list.js',
    });

    return {
      state,
      elements,
      rows,
      adminFetchSpy,
      ns: sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__,
    };
  }

  const candidates = [
    {
      id: 'cand-a',
      memory_id: 'mem-a',
      priority: 1,
      status: 'pending',
      reason: 'reason-a',
      due_at: '2026-01-01',
    },
    {
      id: 'cand-b',
      memory_id: 'mem-b',
      priority: 2,
      status: 'pending',
      reason: 'reason-b',
      due_at: '2026-01-02',
    },
  ];

  it('#897: Refresh 후에도 목록에 남아 있는 선택이 유지된다', async () => {
    const h = buildListPreviewHarness();

    h.ns.renderTable(candidates);
    const firstRow = h.rows.find((r) => r.dataset.candidateId === 'cand-a');
    h.ns.onRowActivate(firstRow);

    expect(h.state.selectedRow?.dataset.candidateId).toBe('cand-a');

    h.ns.renderTable(candidates);

    expect(h.state.selectedRow?.dataset.candidateId).toBe('cand-a');
    expect(h.state.previewMemoryId).toBe('mem-a');

    h.adminFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ candidates, timestamp: '2026-01-01T00:00:00Z' }),
    });

    await h.ns.loadList();

    expect(h.state.selectedRow?.dataset.candidateId).toBe('cand-a');
    expect(h.state.previewMemoryId).toBe('mem-a');
  });

  it('#897 AC8: 같은 필터·페이지 refresh는 선택을 지우지 않는다', async () => {
    const h = buildListPreviewHarness();
    h.ns.buildListUrl = () => '/admin/memory/review-candidates?status=pending&page_size=25&page=1';
    h.ns.buildListQueryKey = () => 'same-key';
    h.ns.commitFilterControls = () => ({
      importance_min: '',
      unused_days_min: '',
      memory_type: '',
      reason_contains: '',
      page_size: '25',
    });
    h.state.lastListQueryKey = 'same-key';

    h.ns.renderTable(candidates);
    h.ns.onRowActivate(h.rows.find((r) => r.dataset.candidateId === 'cand-a'));

    h.adminFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates,
        pagination: {
          page: 1,
          page_size: 25,
          total_count: 2,
          total_pages: 1,
          has_prev: false,
          has_next: false,
        },
        timestamp: '2026-01-01T00:00:00Z',
      }),
    });

    await h.ns.loadList();
    expect(h.state.selectedRow?.dataset.candidateId).toBe('cand-a');
    expect(h.ns.resetBulkSelection).not.toHaveBeenCalled();
  });

  it('#897 AC8: loadList refresh uses committed filters without applying DOM drafts', async () => {
    const h = buildListPreviewHarness();
    const ns = h.ns;
    ns.state.listFilters = {
      importance_min: '0.5',
      unused_days_min: '',
      memory_type: '',
      reason_contains: '',
    };
    ns.state.listPage = 2;
    ns.state.lastListQueryKey = ns.buildListQueryKey(ns.readCommittedFilterValues());
    h.elements['rc-filter-importance'].value = '0.9';

    h.adminFetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates,
        pagination: {
          page: 2,
          page_size: 25,
          total_count: 2,
          total_pages: 1,
          has_prev: true,
          has_next: false,
        },
        timestamp: '2026-01-01T00:00:00Z',
      }),
    });

    await ns.loadList();

    const requestedUrl = String(h.adminFetchSpy.mock.calls[0]?.[0] ?? '');
    expect(requestedUrl).toContain('importance_min=0.5');
    expect(requestedUrl).not.toContain('importance_min=0.9');
    expect(requestedUrl).toContain('page=2');
  });

  it('#897: 새 후보를 열면 미리보기 스크롤이 맨 위로 돌아간다', () => {
    const h = buildListPreviewHarness();
    h.elements['rc-preview-content'].scrollTop = 200;
    h.elements['rc-preview-aside'].scrollTop = 150;

    const row = (candidateId: string, memoryId: string) => ({
      dataset: { candidateId, memoryId, priority: '1', reason: '', due: '' },
      classList: classList(),
      setAttribute: vi.fn(),
    });

    const a = row('a', 'memory-a');
    const b = row('b', 'memory-b');

    h.ns.onRowActivate(a);
    h.elements['rc-preview-content'].scrollTop = 200;
    h.elements['rc-preview-aside'].scrollTop = 150;

    h.ns.onRowActivate(b);

    expect(h.elements['rc-preview-content'].scrollTop).toBe(0);
    expect(h.elements['rc-preview-aside'].scrollTop).toBe(0);
  });

  it('#897: 진단 패널이 기본 접힘이고 후보 목록보다 먼저 닫힌다', () => {
    const diagnosticsIdx = dashboardHtml.indexOf('<details id="rc-diagnostics"');
    const tableWrapIdx = dashboardHtml.indexOf('id="rc-table-wrap"');
    expect(diagnosticsIdx).toBeGreaterThan(-1);
    expect(tableWrapIdx).toBeGreaterThan(-1);
    expect(diagnosticsIdx).toBeLessThan(tableWrapIdx);
    const openTag = dashboardHtml.match(/<details id="rc-diagnostics"[^>]*>/)?.[0] ?? '';
    expect(openTag).not.toMatch(/\bopen\b/);
  });
});

/**
 * #897: 일괄 작업의 대상 범위와 효과를 화면이 정직하게 말하는지.
 * 소스 문자열 매칭이 아니라 실제로 스크립트를 돌려 DOM 결과를 본다.
 */
describe('#897 review queue bulk scope and confirmation', () => {
  const bulkJs = readFileSync(
    resolve(root, 'static/js/review-candidates-panel-bulk.js'),
    'utf8',
  );

  type FakeEl = {
    textContent: string;
    checked?: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    setAttribute: (name: string, value: string) => void;
  };

  function makeEl(): FakeEl {
    return {
      textContent: '',
      checked: false,
      indeterminate: false,
      disabled: false,
      setAttribute: vi.fn(),
    };
  }

  function buildBulkSandbox(options: {
    loadedIds: string[];
    selectedIds: string[];
    confirmResult?: boolean;
  }) {
    const elements: Record<string, FakeEl> = {};
    for (const id of [
      'rc-selected-count',
      'rc-select-all',
      'rc-select-all-scope',
      'rc-bulk-dismiss-btn',
      'rc-bulk-expire-btn',
      'rc-bulk-dismiss-count',
      'rc-bulk-expire-count',
      'rc-bulk-actions',
      'rc-table',
    ]) {
      elements[id] = makeEl();
    }
    const state = {
      selectedCandidateIds: new Set(options.selectedIds),
      currentCandidateIds: options.loadedIds.slice(),
      actionInFlight: false,
    };
    const confirmSpy = vi.fn(() => options.confirmResult ?? false);
    const adminFetchSpy = vi.fn();
    const sandbox: Record<string, any> = {
      console,
      document: {
        getElementById: (id: string) => elements[id] ?? null,
        querySelectorAll: () => [],
      },
      confirm: confirmSpy,
      __MEMENTO_REVIEW_CANDIDATES_PANEL__: {
        $: (id: string) => elements[id] ?? null,
        state,
        syncReviewDismissButtons: vi.fn(),
        showError: vi.fn(),
        showActionToast: vi.fn(),
        adminFetch: () => adminFetchSpy,
        loadList: vi.fn(),
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(bulkJs, context, { filename: 'review-candidates-panel-bulk.js' });
    return {
      elements,
      state,
      confirmSpy,
      adminFetchSpy,
      ns: sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__,
    };
  }

  it('select-all 라벨이 화면에 보이는 행이 아니라 불러온 건수를 말한다', () => {
    const loaded = Array.from({ length: 500 }, (_, i) => 'c' + i);
    const h = buildBulkSandbox({ loadedIds: loaded, selectedIds: [] });
    h.ns.syncBulkControls();
    expect(h.elements['rc-select-all-scope']!.textContent).toBe('500');
  });

  it('선택 건수가 두 일괄 버튼 라벨에 실린다', () => {
    const h = buildBulkSandbox({
      loadedIds: ['a', 'b', 'c'],
      selectedIds: ['a', 'b'],
    });
    h.ns.syncBulkControls();
    expect(h.elements['rc-bulk-dismiss-count']!.textContent).toBe(' (2건)');
    expect(h.elements['rc-bulk-expire-count']!.textContent).toBe(' (2건)');
  });

  it('선택이 0건이면 버튼 라벨에 숫자를 붙이지 않는다', () => {
    const h = buildBulkSandbox({ loadedIds: ['a'], selectedIds: [] });
    h.ns.syncBulkControls();
    expect(h.elements['rc-bulk-dismiss-count']!.textContent).toBe('');
    expect(h.elements['rc-bulk-expire-count']!.textContent).toBe('');
  });

  it('일괄 확인 대화상자가 대상 범위·원본 기억·되돌리기를 말한다', async () => {
    const h = buildBulkSandbox({
      loadedIds: ['a', 'b', 'c'],
      selectedIds: ['a', 'b'],
      confirmResult: false,
    });
    await h.ns.postBulkAction('expire');
    expect(h.confirmSpy).toHaveBeenCalledTimes(1);
    const message = String(h.confirmSpy.mock.calls[0]![0]);
    expect(message).toContain('2건');
    expect(message).toContain('화면에 보이는 행이 아니라');
    expect(message).toContain('지워지지 않고');
    expect(message).toContain('되돌리기');
  });

  it('확인을 거절하면 요청을 보내지 않는다', async () => {
    const h = buildBulkSandbox({
      loadedIds: ['a'],
      selectedIds: ['a'],
      confirmResult: false,
    });
    await h.ns.postBulkAction('dismiss');
    expect(h.adminFetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * #897: 각 액션이 원본 기억에 무엇을 하는지 화면에서 읽을 수 있어야 한다.
 */
describe('#897 review queue action effects are written down', () => {
  it('일괄 작업 옆에 원본 기억 영향과 되돌리기가 적혀 있다', () => {
    expect(dashboardHtml).toContain('rc-bulk-effect-note');
    expect(dashboardHtml).toContain('원본 기억은 지워지지 않고 내용도 바뀌지 않습니다');
    expect(dashboardHtml).toContain('되돌릴 수 있습니다');
  });

  it('검토 버튼이 보존으로 바뀌고 무엇을 갱신하는지 적혀 있다', () => {
    expect(dashboardHtml).toContain('>보존<');
    expect(dashboardHtml).not.toContain('disabled>검토</button>');
    expect(dashboardHtml).toContain('마지막 접근 시각을 지금으로 갱신');
  });
});

/**
 * #897: 대기열 1시간 지표를 판정하고 배너를 지표 카드 앞에 둔다.
 */
describe('#897 review queue health verdict', () => {
  const healthRenderJs = readFileSync(
    resolve(root, 'static/js/review-candidates-panel-health-render.js'),
    'utf8',
  );

  function buildHealthRenderSandbox() {
    const sandbox: Record<string, any> = {
      console,
      document: { querySelector: vi.fn() },
      __MEMENTO_REVIEW_CANDIDATES_PANEL__: {
        escapeHtml: (s: string) =>
          String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;'),
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(healthRenderJs, context, {
      filename: 'review-candidates-panel-health-render.js',
    });
    return { ns: sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__ };
  }

  it('#897: 대기열 지표가 네 가지 상태로 해석된다', () => {
    const { ns } = buildHealthRenderSandbox();

    expect(
      ns.computeQueueVerdict({
        window1h: { candidatesCreated: 10, processedTotal: 12, netFlow: -2 },
      }).state,
    ).toBe('healthy');
    expect(
      ns.computeQueueVerdict({
        window1h: { candidatesCreated: 20, processedTotal: 10, netFlow: 10 },
      }).state,
    ).toBe('growing');
    expect(
      ns.computeQueueVerdict({
        window1h: { candidatesCreated: 5, processedTotal: 0, netFlow: 5 },
      }).state,
    ).toBe('stalled');
    expect(
      ns.computeQueueVerdict({
        window1h: { candidatesCreated: null, processedTotal: 0, netFlow: 0 },
      }).state,
    ).toBe('unknown');
  });

  it('#897: 판정 배너가 지표 카드보다 먼저 렌더된다', () => {
    const { ns } = buildHealthRenderSandbox();
    const html = ns.renderLiveHealthHtml({
      pendingTotal: 3,
      window1h: { candidatesCreated: 1, processedTotal: 2, netFlow: -1 },
      window24h: {},
    });

    expect(html.indexOf('rc-queue-verdict')).toBeLessThan(html.indexOf('m-metric-grid'));
  });
});

describe('#897 review queue filters and pagination (AC8)', () => {
  const filtersJs = readFileSync(
    resolve(root, 'static/js/review-candidates-panel-filters.js'),
    'utf8',
  );

  function buildFilterHarness() {
    const elements: Record<string, any> = {};
    for (const id of [
      'rc-filter-form',
      'rc-filter-importance',
      'rc-filter-unused-days',
      'rc-filter-memory-type',
      'rc-filter-reason',
      'rc-filter-page-size',
      'rc-filter-apply',
      'rc-filter-reset',
      'rc-pagination-prev',
      'rc-pagination-next',
      'rc-pagination-info',
    ]) {
      elements[id] = {
        value: id === 'rc-filter-page-size' ? '25' : '',
        textContent: '',
        disabled: false,
        dataset: {},
        addEventListener: vi.fn(),
      };
    }

    const state = {
      listFilters: {
        importance_min: '',
        unused_days_min: '',
        memory_type: '',
        reason_contains: '',
      },
      listPage: 1,
      listPageSize: 25,
      lastListQueryKey: '{"importance_min":"","unused_days_min":"","memory_type":"","reason_contains":"","page":1,"page_size":"25"}',
      selectedCandidateIds: new Set(['cand-a']),
      selectedRow: { dataset: { candidateId: 'cand-a' } },
      previewMemoryId: 'mem-a',
      actionInFlight: false,
      currentCandidateIds: ['cand-a'],
    };

    const resetBulkSelection = vi.fn();
    const clearRowSelection = vi.fn();
    const resetPreviewPanel = vi.fn();
    const loadList = vi.fn();

    const sandbox: Record<string, any> = {
      document: { getElementById: (id: string) => elements[id] ?? null },
      __MEMENTO_REVIEW_CANDIDATES_PANEL__: {
        $: (id: string) => elements[id] ?? null,
        state,
        resetBulkSelection,
        clearRowSelection,
        resetPreviewPanel,
        loadList,
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(filtersJs, context, { filename: 'review-candidates-panel-filters.js' });
    return {
      ns: sandbox.__MEMENTO_REVIEW_CANDIDATES_PANEL__,
      state,
      elements,
      resetBulkSelection,
      clearRowSelection,
      resetPreviewPanel,
      loadList,
    };
  }

  it('dashboard.html includes filter and pagination controls', () => {
    expect(dashboardHtml).toContain('id="rc-filter-form"');
    expect(dashboardHtml).toContain('id="rc-filter-importance"');
    expect(dashboardHtml).toContain('id="rc-filter-unused-days"');
    expect(dashboardHtml).toContain('id="rc-filter-memory-type"');
    expect(dashboardHtml).toContain('id="rc-filter-reason"');
    expect(dashboardHtml).toContain('id="rc-filter-page-size"');
    expect(dashboardHtml).toContain('id="rc-pagination-prev"');
    expect(dashboardHtml).toContain('/static/js/review-candidates-panel-filters.js');
    expect(dashboardHtml).toMatch(/<nav class="rc-pagination" aria-label="후보 목록 페이지">/);
  });

  it('buildListUrl encodes committed filters and pagination contract', () => {
    const h = buildFilterHarness();
    h.state.listFilters = {
      importance_min: '0.8',
      unused_days_min: '90',
      memory_type: 'semantic',
      reason_contains: 'anchor=',
    };
    h.state.listPage = 2;
    h.state.listPageSize = 50;

    const url = h.ns.buildListUrl();
    expect(url).toContain('status=pending');
    expect(url).toContain('importance_min=0.8');
    expect(url).toContain('unused_days_min=90');
    expect(url).toContain('memory_type=semantic');
    expect(url).toContain('reason_contains=anchor%3D');
    expect(url).toContain('page_size=50');
    expect(url).toContain('page=2');
  });

  it('filter apply clears bulk selection and preview', () => {
    const h = buildFilterHarness();
    h.ns.wireReviewListFilters();
    h.elements['rc-filter-importance'].value = '0.9';
    const applyClick = h.elements['rc-filter-apply'].addEventListener.mock.calls.find(
      (call) => call[0] === 'click',
    )?.[1];
    expect(applyClick).toBeTypeOf('function');
    applyClick();

    expect(h.resetBulkSelection).toHaveBeenCalledWith([]);
    expect(h.clearRowSelection).toHaveBeenCalled();
    expect(h.resetPreviewPanel).toHaveBeenCalled();
    expect(h.loadList).toHaveBeenCalled();
  });

  it('readCommittedFilterValues ignores unapplied DOM drafts', () => {
    const h = buildFilterHarness();
    h.state.listFilters.importance_min = '0.5';
    h.elements['rc-filter-importance'].value = '0.9';
    h.state.listPage = 2;

    expect(h.ns.readCommittedFilterValues()).toMatchObject({
      importance_min: '0.5',
      page_size: '25',
    });
    expect(h.ns.buildListUrl()).toContain('importance_min=0.5');
    expect(h.ns.buildListUrl()).not.toContain('importance_min=0.9');
    expect(h.ns.buildListUrl()).toContain('page=2');
  });

  it('buildListUrl preserves active page for background poll refresh', () => {
    const h = buildFilterHarness();
    h.state.listPage = 3;
    expect(h.ns.buildListUrl()).toContain('page=3');
    expect(h.ns.buildListUrl()).not.toContain('page=1');
  });

  it('filter form submit prevents default and applies filters', () => {
    const h = buildFilterHarness();
    h.ns.wireReviewListFilters();
    const preventDefault = vi.fn();
    const submitHandler = h.elements['rc-filter-form'].addEventListener.mock.calls.find(
      (call) => call[0] === 'submit',
    )?.[1];
    expect(submitHandler).toBeTypeOf('function');
    submitHandler({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(h.loadList).toHaveBeenCalled();
  });

});
