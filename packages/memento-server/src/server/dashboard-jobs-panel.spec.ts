/**
 * Dashboard Jobs panel smoke (#832 / #833 / #834).
 * node:vm harness pattern — see dashboard-review-candidates-panel.spec.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');

const JOBS_PANEL_SCRIPTS = [
  'jobs-panel-shared.js',
  'jobs-panel-render.js',
  'jobs-panel-fetch.js',
  'jobs-panel.js',
] as const;

function readJobsPanelSources(): string {
  return JOBS_PANEL_SCRIPTS.map((name) =>
    readFileSync(resolve(root, 'static/js', name), 'utf8'),
  ).join('\n');
}

const tabsJs = [
  'dashboard-tabs-panels.js',
  'dashboard-tabs-init.js',
  'dashboard-tabs.js',
]
  .map((name) => readFileSync(resolve(root, 'static/js', name), 'utf8'))
  .join('\n');

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

type JobsHarnessOptions = {
  confirmImpl?: (message: string) => boolean;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<unknown>;
};

function createJobsHarness(options: JobsHarnessOptions = {}) {
  const elements: Record<string, any> = {};
  let scheduleClickHandler: ((event: unknown) => void) | null = null;
  let timelineClickHandler: ((event: unknown) => void) | null = null;
  const buttonHandlers: Record<string, Array<() => void>> = {};

  function el(id: string, extras: Record<string, unknown> = {}) {
    elements[id] = {
      id,
      textContent: '',
      innerHTML: '',
      dataset: {},
      disabled: false,
      children: [] as unknown[],
      classList: createClassList(),
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (!buttonHandlers[id]) {
          buttonHandlers[id] = [];
        }
        if (event === 'click') {
          buttonHandlers[id].push(handler);
        }
      }),
      replaceChildren(...nodes: unknown[]) {
        this.children = nodes;
      },
      appendChild(child: unknown) {
        this.children.push(child);
        return child;
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      ...extras,
    };
    return elements[id];
  }

  el('jobs-refresh-btn');
  el('jobs-status-line');
  el('jobs-error');
  el('jobs-schedule-tbody', {
    addEventListener: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (event === 'click') {
        scheduleClickHandler = handler;
      }
    }),
  });
  el('jobs-queue-summary');
  el('jobs-run-history-tbody');
  el('jobs-timeline-tbody', {
    addEventListener: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (event === 'click') {
        timelineClickHandler = handler;
      }
    }),
  });
  el('jobs-timeline-selected');
  el('jobs-health-summary');
  el('jobs-pause-btn', { disabled: true });
  el('jobs-resume-btn', { disabled: true });
  el('jobs-run-now-btn', { disabled: true });
  el('jobs-logs-selected');
  el('jobs-logs-tbody');
  el('jobs-logs-refresh-btn');
  el('tab-jobs');

  const defaultFetch = async (url: string, _init?: RequestInit) => {
    if (String(url).includes('/admin/batch/stats')) {
      return {
        ok: true,
        json: async () => ({
          schedulerRunning: true,
          health: { memoryUsage: 10, runningJobs: 0, queueSize: 0, errorRate: 0, uptime: 1000 },
          jobs: [
            {
              name: 'cleanup',
              intervalMs: 3600000,
              enabled: true,
              paused: false,
              lastExecution: null,
              totalExecutions: 1,
              errorCount: 0,
              errorRate: 0,
              isRunning: false,
            },
          ],
          queue: { size: 0, runningCount: 0, runningNames: [], queuedNames: [] },
          timestamp: '2026-09-06T08:00:00.000Z',
        }),
      };
    }
    if (String(url).includes('/admin/batch/run-history')) {
      return { ok: true, json: async () => ({ entries: [], limit: 50 }) };
    }
    if (String(url).includes('/logs')) {
      return {
        ok: true,
        json: async () => ({
          runId: 'jr_fail',
          logs: [
            {
              id: 'jrl_1',
              runId: 'jr_fail',
              level: 'info',
              message: 'started',
              createdAt: '2026-09-06T00:00:00.000Z',
            },
          ],
          limit: 200,
        }),
      };
    }
    if (String(url).includes('/admin/batch/runs')) {
      return {
        ok: true,
        json: async () => ({
          runs: [
            {
              id: 'jr_ok',
              jobName: 'cleanup',
              trigger: 'schedule',
              startedAt: '2026-09-06T00:00:00.000Z',
              endedAt: '2026-09-06T00:00:01.000Z',
              success: true,
              durationMs: 1000,
            },
            {
              id: 'jr_fail',
              jobName: 'cleanup',
              trigger: 'manual',
              startedAt: '2026-09-06T01:00:00.000Z',
              endedAt: '2026-09-06T01:00:02.000Z',
              success: false,
              durationMs: 2000,
            },
          ],
          limit: 50,
        }),
      };
    }
    if (
      String(url).includes('/admin/batch/pause') ||
      String(url).includes('/admin/batch/resume') ||
      String(url).includes('/admin/batch/run')
    ) {
      return { ok: true, json: async () => ({ message: 'ok', jobType: 'cleanup' }) };
    }
    return { ok: false, json: async () => ({}) };
  };

  const fetchMock = vi.fn(options.fetchImpl ?? defaultFetch);
  const confirmMock = vi.fn(options.confirmImpl ?? (() => true));

  const sandbox: Record<string, any> = {
    console,
    confirm: confirmMock,
    document: {
      getElementById: (id: string) => elements[id] ?? null,
      createElement: (tag: string) => {
        const node: Record<string, any> = {
          tagName: tag.toUpperCase(),
          textContent: '',
          className: '',
          type: '',
          dataset: {},
          disabled: false,
          classList: createClassList(),
          children: [] as unknown[],
          appendChild(child: unknown) {
            (this.children as unknown[]).push(child);
            return child;
          },
          setAttribute: vi.fn(),
          closest(selector: string) {
            if (selector === 'tr') {
              return this._row || null;
            }
            return null;
          },
        };
        return node;
      },
    },
    fetch: fetchMock,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const panelJs = readJobsPanelSources();
  const context = vm.createContext(sandbox);
  vm.runInContext(panelJs, context, { filename: 'jobs-panel.js' });

  return {
    elements,
    sandbox,
    fetchMock,
    confirmMock,
    getScheduleClickHandler: () => scheduleClickHandler,
    getTimelineClickHandler: () => timelineClickHandler,
    clickButton(id: string) {
      const handlers = buttonHandlers[id] || [];
      for (const handler of handlers) {
        handler();
      }
    },
    async init() {
      sandbox.initJobsPanel();
      await vi.waitFor(() => {
        expect(elements['jobs-schedule-tbody'].children.length).toBeGreaterThan(0);
      });
    },
  };
}

describe('dashboard jobs panel (#832)', () => {
  it('dashboard.html registers Jobs tab, panel markup, and scripts', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-jobs"');
    expect(dashboardHtml).toContain('data-tab="jobs"');
    expect(dashboardHtml).toContain('id="tab-jobs"');
    expect(dashboardHtml).toContain('session-only');
    expect(dashboardHtml).toContain('id="jobs-refresh-btn"');
    expect(dashboardHtml).toContain('id="jobs-schedule-table"');
    expect(dashboardHtml).toContain('id="jobs-queue-summary"');
    expect(dashboardHtml).toContain('id="jobs-run-history"');
    expect(dashboardHtml).toMatch(/process-local|#833/i);
    for (const name of JOBS_PANEL_SCRIPTS) {
      expect(dashboardHtml).toContain(`/static/js/${name}`);
    }
  });

  it('dashboard.html registers durable job_run timeline markup and disclaimer (#833)', () => {
    expect(dashboardHtml).toContain('id="jobs-timeline-tbody"');
    expect(dashboardHtml).toContain('id="jobs-timeline-selected"');
    expect(dashboardHtml).toContain('/admin/batch/runs');
    expect(dashboardHtml).toMatch(/job_run/i);
    expect(dashboardHtml).toMatch(/durable/i);
    expect(dashboardHtml).not.toMatch(/재시작 후 소멸/);
  });

  it('dashboard.html registers Phase 3 logs + pause/resume/Run now markup (#834)', () => {
    expect(dashboardHtml).toContain('id="jobs-logs-tbody"');
    expect(dashboardHtml).toContain('id="jobs-logs-selected"');
    expect(dashboardHtml).toContain('id="jobs-logs-refresh-btn"');
    expect(dashboardHtml).toContain('id="jobs-pause-btn"');
    expect(dashboardHtml).toContain('id="jobs-resume-btn"');
    expect(dashboardHtml).toContain('id="jobs-run-now-btn"');
    expect(dashboardHtml).toMatch(/\/admin\/batch\/runs\/:runId\/logs|runs\/:runId\/logs/i);
    expect(dashboardHtml).toMatch(/Pause/i);
    expect(dashboardHtml).toMatch(/Resume/i);
    expect(dashboardHtml).toMatch(/Run now/i);
    expect(dashboardHtml).toMatch(/#834/);
  });

  it('dashboard tabs register jobs panel and init on tab open', () => {
    expect(tabsJs).toContain("'tab-jobs'");
    expect(tabsJs).toContain("name: 'jobs'");
    expect(tabsJs).toContain('initJobsPanel');
  });

  it('jobs panel sources have no setInterval or SSE', () => {
    const panelJs = readJobsPanelSources();
    expect(panelJs).not.toMatch(/\bsetInterval\b/);
    expect(panelJs).not.toMatch(/\bEventSource\b/);
    expect(panelJs).toContain('/admin/batch/stats');
    expect(panelJs).toContain('/admin/batch/run-history');
    expect(panelJs).toContain('/admin/batch/runs');
    expect(panelJs).toContain('initJobsPanel');
  });

  it('jobs panel Phase 3 sources wire logs + confirm writes (no SSE) (#834)', () => {
    const panelJs = readJobsPanelSources();
    expect(panelJs).not.toMatch(/\bsetInterval\b/);
    expect(panelJs).not.toMatch(/\bEventSource\b/);
    expect(panelJs).toContain('/admin/batch/pause');
    expect(panelJs).toContain('/admin/batch/resume');
    expect(panelJs).toContain('/admin/batch/run');
    expect(panelJs).toMatch(/\/logs/);
    expect(panelJs).toMatch(/\bconfirm\b/);
    expect(panelJs).toContain('selectRun');
    expect(panelJs).toContain('jobs-retry-btn');
  });

  it('refresh fetches stats+history and error path does not wipe prior snapshot', async () => {
    const h = createJobsHarness({
      fetchImpl: async (url: string) => {
        if (String(url).includes('/admin/batch/stats')) {
          return {
            ok: true,
            json: async () => ({
              schedulerRunning: true,
              health: { memoryUsage: 10, runningJobs: 0, queueSize: 0, errorRate: 0, uptime: 1000 },
              jobs: [
                {
                  name: 'cleanup',
                  intervalMs: 3600000,
                  enabled: true,
                  lastExecution: null,
                  totalExecutions: 1,
                  errorCount: 0,
                  errorRate: 0,
                  isRunning: false,
                },
              ],
              queue: { size: 0, runningCount: 0, runningNames: [], queuedNames: [] },
              timestamp: '2026-09-06T08:00:00.000Z',
            }),
          };
        }
        if (String(url).includes('/admin/batch/run-history')) {
          return {
            ok: true,
            json: async () => ({
              entries: [{ jobType: 'cleanup', success: true }],
              limit: 50,
            }),
          };
        }
        if (String(url).includes('/admin/batch/runs') && !String(url).includes('/logs')) {
          return {
            ok: true,
            json: async () => ({
              runs: String(url).includes('job=cleanup')
                ? [
                    {
                      id: 'jr_1',
                      jobName: 'cleanup',
                      trigger: 'schedule',
                      startedAt: '2026-09-06T00:00:00.000Z',
                      endedAt: '2026-09-06T00:00:01.000Z',
                      success: true,
                      durationMs: 1000,
                    },
                  ]
                : [],
              limit: 50,
            }),
          };
        }
        return { ok: false, json: async () => ({}) };
      },
    });

    expect(typeof h.sandbox.initJobsPanel).toBe('function');
    await h.init();

    expect(h.fetchMock.mock.calls.some((c) => String(c[0]).includes('/admin/batch/stats'))).toBe(
      true,
    );
    expect(
      h.fetchMock.mock.calls.some((c) => String(c[0]).includes('/admin/batch/run-history')),
    ).toBe(true);
    expect(h.fetchMock.mock.calls.some((c) => String(c[0]).includes('/admin/batch/runs'))).toBe(
      true,
    );
    expect(h.elements['jobs-timeline-tbody'].children.length).toBeGreaterThan(0);
    expect(h.elements['jobs-timeline-selected'].textContent).toBe('All jobs');

    const tbody = h.elements['jobs-schedule-tbody'];
    const priorChildCount = tbody.children.length;

    h.fetchMock.mockImplementation(async () => {
      throw new Error('network down');
    });

    await h.sandbox.__MEMENTO_JOBS_PANEL__.refresh();
    expect(tbody.children.length).toBe(priorChildCount);
    expect(h.elements['jobs-error'].textContent).toMatch(/network down|실패|error/i);
  });

  it('clicking a schedule row selects the job and fetches /admin/batch/runs?job= timeline (#833)', async () => {
    const h = createJobsHarness();
    await h.init();
    expect(typeof h.getScheduleClickHandler()).toBe('function');

    const clickedRow = {
      dataset: { jobName: 'cleanup' },
      closest: () => ({ dataset: { jobName: 'cleanup' } }),
    };
    h.getScheduleClickHandler()!({ target: clickedRow });

    await vi.waitFor(() => {
      expect(
        h.fetchMock.mock.calls.some(
          (c) => String(c[0]).includes('/admin/batch/runs') && String(c[0]).includes('job=cleanup'),
        ),
      ).toBe(true);
    });
    await vi.waitFor(() => {
      expect(h.elements['jobs-timeline-selected'].textContent).toBe('cleanup');
    });
    expect(h.elements['jobs-timeline-tbody'].children.length).toBeGreaterThan(0);
  });

  it('selecting a timeline run loads Logs panel via GET /admin/batch/runs/:runId/logs (#834)', async () => {
    const h = createJobsHarness();
    await h.init();

    const scheduleHandler = h.getScheduleClickHandler();
    expect(scheduleHandler).toBeTypeOf('function');
    scheduleHandler!({
      target: {
        dataset: { jobName: 'cleanup' },
        closest: () => ({ dataset: { jobName: 'cleanup' } }),
      },
    });
    await vi.waitFor(() => {
      expect(h.elements['jobs-timeline-tbody'].children.length).toBeGreaterThan(0);
    });

    const timelineHandler = h.getTimelineClickHandler();
    expect(timelineHandler).toBeTypeOf('function');
    timelineHandler!({
      target: {
        dataset: {},
        closest: () => ({
          dataset: { runId: 'jr_fail', jobName: 'cleanup' },
        }),
      },
    });

    await vi.waitFor(() => {
      expect(
        h.fetchMock.mock.calls.some((c) =>
          String(c[0]).includes('/admin/batch/runs/jr_fail/logs'),
        ),
      ).toBe(true);
    });
    await vi.waitFor(() => {
      expect(h.elements['jobs-logs-selected'].textContent).toMatch(/jr_fail/);
    });
    expect(h.elements['jobs-logs-tbody'].children.length).toBeGreaterThan(0);
  });

  it('Pause / Resume / Run now require confirm before POST (#834)', async () => {
    const h = createJobsHarness({ confirmImpl: () => false });
    await h.init();

    h.getScheduleClickHandler()!({
      target: {
        dataset: { jobName: 'cleanup' },
        closest: () => ({ dataset: { jobName: 'cleanup' } }),
      },
    });
    await vi.waitFor(() => {
      expect(h.elements['jobs-pause-btn'].disabled).toBe(false);
    });

    const ns = h.sandbox.__MEMENTO_JOBS_PANEL__;
    const postCallsBefore = h.fetchMock.mock.calls.filter((c) => {
      const init = c[1] as { method?: string } | undefined;
      return init && String(init.method).toUpperCase() === 'POST';
    }).length;

    await ns.pauseSelectedJob();
    await ns.resumeSelectedJob();
    await ns.runSelectedJobNow();

    expect(h.confirmMock).toHaveBeenCalled();
    const postCallsAfter = h.fetchMock.mock.calls.filter((c) => {
      const init = c[1] as { method?: string } | undefined;
      return init && String(init.method).toUpperCase() === 'POST';
    }).length;
    expect(postCallsAfter).toBe(postCallsBefore);

    h.confirmMock.mockImplementation(() => true);
    await ns.pauseSelectedJob();
    expect(
      h.fetchMock.mock.calls.some(
        (c) =>
          String(c[0]).includes('/admin/batch/pause') &&
          String((c[1] as { method?: string })?.method).toUpperCase() === 'POST',
      ),
    ).toBe(true);

    await ns.resumeSelectedJob();
    expect(
      h.fetchMock.mock.calls.some(
        (c) =>
          String(c[0]).includes('/admin/batch/resume') &&
          String((c[1] as { method?: string })?.method).toUpperCase() === 'POST',
      ),
    ).toBe(true);

    await ns.runSelectedJobNow();
    expect(
      h.fetchMock.mock.calls.some(
        (c) =>
          String(c[0]).includes('/admin/batch/run') &&
          !String(c[0]).includes('run-history') &&
          String((c[1] as { method?: string })?.method).toUpperCase() === 'POST',
      ),
    ).toBe(true);
  });

  it('Failed Retry button only on success=false and POSTs /admin/batch/run (#834)', async () => {
    const h = createJobsHarness();
    await h.init();

    const rows = h.elements['jobs-timeline-tbody'].children as Array<Record<string, any>>;
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const findRetry = (row: Record<string, any>) => {
      const cells = row.children as Array<Record<string, any>>;
      for (const cell of cells) {
        for (const child of (cell.children || []) as Array<Record<string, any>>) {
          if (child.className && String(child.className).includes('jobs-retry-btn')) {
            return child;
          }
        }
      }
      return null;
    };

    const okRow = rows.find((r) => r.dataset && r.dataset.runId === 'jr_ok');
    const failRow = rows.find((r) => r.dataset && r.dataset.runId === 'jr_fail');
    expect(okRow).toBeTruthy();
    expect(failRow).toBeTruthy();
    expect(findRetry(okRow!)).toBeNull();
    const retryBtn = findRetry(failRow!);
    expect(retryBtn).toBeTruthy();
    expect(retryBtn!.dataset.jobName).toBe('cleanup');
    expect(retryBtn!.dataset.action).toBe('retry');

    const timelineHandler = h.getTimelineClickHandler();
    expect(timelineHandler).toBeTypeOf('function');
    timelineHandler!({
      target: {
        dataset: { action: 'retry', jobName: 'cleanup' },
        className: 'm-button m-button--secondary jobs-retry-btn',
        closest: () => failRow,
      },
    });

    await vi.waitFor(() => {
      expect(h.confirmMock).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      const runPost = h.fetchMock.mock.calls.find((c) => {
        const url = String(c[0]);
        const init = c[1] as { method?: string; body?: string } | undefined;
        return (
          url.includes('/admin/batch/run') &&
          !url.includes('run-history') &&
          String(init?.method).toUpperCase() === 'POST'
        );
      });
      expect(runPost).toBeTruthy();
      expect(String(runPost![1] && (runPost![1] as { body?: string }).body)).toContain(
        '"jobType":"cleanup"',
      );
    });
  });
});
