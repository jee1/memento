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
    expect(panelJs).toContain('/admin/memory/review-candidates?status=pending');
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

    expect(harness.elements['rc-toast'].textContent).toContain('2 new review candidates');
    expect(harness.elements['rc-toast'].textContent).toContain('Open Review Queue to refresh.');
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

    expect(harness.elements['rc-toast'].textContent).toContain('1 new review candidate');
    expect(harness.elements['rc-toast'].textContent).toContain('List updated.');
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
