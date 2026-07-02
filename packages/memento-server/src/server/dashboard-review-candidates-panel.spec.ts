import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { REVIEW_QUEUE_DASHBOARD_BOOT_MARKER } from './review-queue-dashboard-boot.js';

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
const POLL_COMPANION_SCRIPTS = [
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

function createPollHarness(options: { activeReviewTab?: boolean } = {}) {
  const elements: Record<string, any> = {};
  const timers: Array<{ delayMs: number; callback: () => void }> = [];
  const state = {
    lastPendingCount: 2,
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

  const sandbox: Record<string, any> = {
    console,
    document: {
      visibilityState: 'visible',
      addEventListener: vi.fn()
    },
    setTimeout: (callback: () => void, delayMs: number) => {
      timers.push({ callback, delayMs });
      return timers.length;
    },
    clearTimeout: vi.fn(),
    __MEMENTO_REVIEW_QUEUE__: {
      pollIntervalMs: 60_000,
      pollErrorBackoffMs: [1_000, 5_000]
    },
    __MEMENTO_REVIEW_CANDIDATES_PANEL__: {
      $: (id: string) => elements[id] ?? null,
      setHidden: vi.fn(),
      state,
      OS_NOTIFY_TAG: 'memento-review-queue',
      LS_NOTIFY_PROMPT_DISMISSED: 'memento-review-notify-dismissed',
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
    expect(panelJs).toContain('__MEMENTO_REVIEW_QUEUE__');
    expect(panelJs).toContain('runPollCycle');
    expect(panelJs).toContain('startPollingIfNeeded');
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
});
