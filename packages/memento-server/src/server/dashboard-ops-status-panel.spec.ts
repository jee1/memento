/**
 * Dashboard Ops status panel smoke (#1048).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const opsStatusPanelJs = readFileSync(resolve(root, 'static/js/ops-status-panel.js'), 'utf8');
const tabsPanelsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs-panels.js'), 'utf8');

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
};

function createOpsStatusHarness(options: HarnessOptions = {}) {
  const elements: Record<string, any> = {};
  const buttonHandlers: Record<string, Array<() => void>> = {};

  function el(id: string, extras: Record<string, unknown> = {}) {
    elements[id] = {
      id,
      textContent: '',
      innerHTML: '',
      attributes: {} as Record<string, string>,
      classList: createClassList(),
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
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
    return elements[id];
  }

  [
    'ops-status-refresh-btn',
    'ops-status-loading',
    'ops-status-error',
    'ops-status-card-system',
    'ops-status-card-batch',
    'ops-status-card-flow',
    'ops-status-process-uptime',
    'ops-status-scheduler',
    'ops-status-scheduler-uptime',
    'ops-status-database',
    'ops-status-version',
    'ops-status-batch-failed',
    'ops-status-batch-impact',
    'ops-status-batch-success',
    'ops-status-batch-last-failed',
    'ops-status-batch-now',
    'ops-status-review-pending',
    'ops-status-review-netflow',
    'ops-status-embedding',
  ].forEach((id) => el(id));

  const fetchCalls: string[] = [];
  const sandbox: Record<string, unknown> = {
    console,
    document: {
      readyState: 'complete',
      addEventListener: vi.fn(),
      getElementById: (id: string) => elements[id] ?? null,
    },
    fetch: vi.fn(async (url: string) => {
      fetchCalls.push(url);
      if (options.fetchImpl) {
        const data = await options.fetchImpl(url);
        return {
          ok: true,
          json: async () => data,
        };
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    }),
    __MEMENTO_OPS_STATUS_PANEL__: undefined,
  };

  vm.createContext(sandbox);
  vm.runInContext(opsStatusPanelJs, sandbox);

  const ns = sandbox.__MEMENTO_OPS_STATUS_PANEL__ as {
    STATUS_URL: string;
    refresh: () => Promise<void>;
  };

  return {
    ns,
    elements,
    fetchCalls,
    clickRefresh() {
      for (const handler of buttonHandlers['ops-status-refresh-btn'] || []) {
        handler();
      }
    },
  };
}

describe('dashboard ops status panel', () => {
  it('includes the ops status tab button and panel in dashboard.html', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-ops-status"');
    expect(dashboardHtml).toContain('id="tab-ops-status"');
    expect(dashboardHtml).toContain('data-tab="ops-status"');
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

  it('fetches /admin/status and renders server-formatted human durations without percent signs', async () => {
    const mockResponse = {
      timestamp: '2026-09-19T00:00:00.000Z',
      windowDays: 30,
      dataSince: '2026-09-01T00:00:00.000Z',
      since: '2026-08-20T00:00:00.000Z',
      process: {
        status: 'ok',
        uptimeMs: 3_600_000,
        uptimeHuman: '1시간',
        version: '1.0.0',
        database: 'connected',
      },
      scheduler: {
        status: 'ok',
        running: true,
        uptimeMs: 120_000,
        uptimeHuman: '2분',
        runningJobs: 1,
        queueSize: 0,
      },
      batchImpact: {
        status: 'ok',
        since: '2026-08-20T00:00:00.000Z',
        failedRunCount: 2,
        durationMsSum: 720_000,
        durationHuman: '약 12분',
        successRunCount: 5,
        lastFailedAt: '2026-09-18T00:00:00.000Z',
      },
      review: {
        status: 'ok',
        pendingTotal: 3,
        netFlow1h: -1,
      },
      embedding: {
        status: 'ok',
        provider: 'minilm',
        problemCount: 4,
      },
    };

    const harness = createOpsStatusHarness({
      fetchImpl: async (url) => {
        expect(url).toBe('/admin/status');
        return mockResponse;
      },
    });

    await harness.ns.refresh();

    expect(harness.fetchCalls).toContain('/admin/status');
    expect(harness.elements['ops-status-process-uptime'].textContent).toBe('1시간');
    expect(harness.elements['ops-status-scheduler'].textContent).toBe('실행 중');
    expect(harness.elements['ops-status-scheduler-uptime'].textContent).toBe('2분');
    expect(harness.elements['ops-status-batch-impact'].textContent).toBe('약 12분');
    expect(harness.elements['ops-status-review-pending'].textContent).toBe('3');
    expect(harness.elements['ops-status-embedding'].textContent).toBe('minilm · 문제 4건');

    const rendered = [
      harness.elements['ops-status-process-uptime'].textContent,
      harness.elements['ops-status-scheduler'].textContent,
      harness.elements['ops-status-scheduler-uptime'].textContent,
      harness.elements['ops-status-batch-impact'].textContent,
      harness.elements['ops-status-review-pending'].textContent,
      harness.elements['ops-status-review-netflow'].textContent,
      harness.elements['ops-status-embedding'].textContent,
    ].join(' ');
    expect(rendered).not.toContain('%');
  });

  it('labels process uptime and scheduler uptime separately with the agreed lexicon', async () => {
    expect(dashboardHtml).toContain('프로세스 가동');
    expect(dashboardHtml).toContain('스케줄러 가동');
    expect(dashboardHtml).toContain('배치 영향 시간');
    expect(dashboardHtml).toContain('운영 흐름');
    expect(dashboardHtml).toContain('순유입 (1h)');
    expect(dashboardHtml).toContain('지금');
    expect(dashboardHtml).not.toContain('실패 소요 시간 합');
    expect(dashboardHtml).not.toContain('검토 1시간 순변');

    const mockResponse = {
      timestamp: '2026-09-19T00:00:00.000Z',
      windowDays: 30,
      dataSince: '2026-09-01T00:00:00.000Z',
      since: '2026-08-20T00:00:00.000Z',
      process: {
        status: 'ok',
        uptimeMs: 302_400_000,
        uptimeHuman: '3일 14시간',
        version: '1.0.0',
        database: 'connected',
      },
      scheduler: {
        status: 'ok',
        running: true,
        uptimeMs: 302_400_000 - 7_200_000,
        uptimeHuman: '3일 12시간',
        runningJobs: 2,
        queueSize: 1,
      },
      batchImpact: {
        status: 'ok',
        since: '2026-08-20T00:00:00.000Z',
        failedRunCount: 0,
        durationMsSum: 0,
        durationHuman: '0초',
        successRunCount: 0,
        lastFailedAt: null,
      },
      review: {
        status: 'ok',
        pendingTotal: 0,
        netFlow1h: 0,
      },
      embedding: {
        status: 'ok',
        provider: 'minilm',
        problemCount: 0,
      },
    };

    const harness = createOpsStatusHarness({
      fetchImpl: async () => mockResponse,
    });

    await harness.ns.refresh();

    expect(harness.elements['ops-status-process-uptime'].textContent).toBe('3일 14시간');
    expect(harness.elements['ops-status-scheduler-uptime'].textContent).toBe('3일 12시간');
    expect(harness.elements['ops-status-batch-now'].textContent).toContain('2');
    expect(harness.elements['ops-status-batch-now'].textContent).toContain('1');
  });
});
