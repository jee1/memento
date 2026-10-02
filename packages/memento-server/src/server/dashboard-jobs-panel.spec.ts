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
      className: '',
      attributes: {} as Record<string, string>,
      classList: createClassList(),
      setAttribute(name: string, value: string) {
        this.attributes[name] = value;
      },
      focus: vi.fn(),
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
  el('jobs-loading');
  el('jobs-error');
  el('jobs-schedule-empty');
  el('jobs-schedule-table-wrap');
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
  el('jobs-health-summary');
  el('jobs-logs-tbody');
  el('jobs-logs-refresh-btn');
  el('jobs-kpis');
  el('jobs-drawer-job');
  el('jobs-drawer-run');
  el('jobs-drawer-badge');
  el('jobs-dtab-runs', {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'click' || event === 'keydown') {
        if (!buttonHandlers['jobs-dtab-runs']) {
          buttonHandlers['jobs-dtab-runs'] = [];
        }
        buttonHandlers['jobs-dtab-runs'].push(handler);
      }
    }),
  });
  el('jobs-dtab-logs', {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'click' || event === 'keydown') {
        if (!buttonHandlers['jobs-dtab-logs']) {
          buttonHandlers['jobs-dtab-logs'] = [];
        }
        buttonHandlers['jobs-dtab-logs'].push(handler);
      }
    }),
  });
  el('jobs-dtab-history', {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'click' || event === 'keydown') {
        if (!buttonHandlers['jobs-dtab-history']) {
          buttonHandlers['jobs-dtab-history'] = [];
        }
        buttonHandlers['jobs-dtab-history'].push(handler);
      }
    }),
  });
  el('jobs-dpanel-runs');
  el('jobs-dpanel-logs', { classList: createClassList() });
  elements['jobs-dpanel-logs'].classList.add('hidden');
  el('jobs-dpanel-history', { classList: createClassList() });
  elements['jobs-dpanel-history'].classList.add('hidden');
  el('tab-jobs');

  const defaultFetch = async (url: string, _init?: RequestInit) => {
    if (String(url).includes('/admin/batch/stats')) {
      return {
        ok: true,
        json: async () => ({
          schedulerRunning: true,
          readOnly: false,
          health: {
            memoryUsage: 10,
            runningJobs: 0,
            queueSize: 0,
            errorRate: 0,
            uptime: 1000,
            uptimeHuman: '1초',
          },
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
          attributes: {} as Record<string, string>,
          appendChild(child: unknown) {
            (this.children as unknown[]).push(child);
            return child;
          },
          setAttribute(name: string, value: string) {
            this.attributes[name] = value;
          },
          closest(selector: string) {
            if (selector === 'tr') {
              return this._row || null;
            }
            if (selector === '.jobs-row-menu') {
              return this._jobsRowMenu || null;
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

  it('Jobs panel uses shared m-empty / m-loading / m-error primitives (#965)', () => {
    expect(dashboardHtml).toContain('id="jobs-loading" class="m-loading hidden"');
    expect(dashboardHtml).toContain('id="jobs-error" class="m-error hidden"');
    expect(dashboardHtml).toContain('id="jobs-schedule-empty" class="m-empty hidden"');
    expect(dashboardHtml).not.toContain('jobs-banner');
    const panelJs = readJobsPanelSources();
    expect(panelJs).toContain('setLoading');
    expect(panelJs).toContain('jobs-schedule-empty');
  });

  it('dashboard.html registers durable job_run timeline markup and disclaimer (#833)', () => {
    expect(dashboardHtml).toContain('id="jobs-timeline-tbody"');
    expect(dashboardHtml).toContain('id="jobs-drawer"');
    expect(dashboardHtml).toContain('/admin/batch/runs');
    expect(dashboardHtml).toMatch(/job_run/i);
    expect(dashboardHtml).toMatch(/durable/i);
    expect(dashboardHtml).not.toMatch(/재시작 후 소멸/);
  });

  it('dashboard.html registers Phase 3 logs + drawer tabs (#834 / #1152)', () => {
    expect(dashboardHtml).toContain('id="jobs-logs-tbody"');
    expect(dashboardHtml).toContain('id="jobs-logs-refresh-btn"');
    expect(dashboardHtml).not.toContain('id="jobs-actions"');
    expect(dashboardHtml).not.toContain('id="jobs-pause-btn"');
    expect(dashboardHtml).not.toContain('id="jobs-resume-btn"');
    expect(dashboardHtml).not.toContain('id="jobs-run-now-btn"');
    expect(dashboardHtml).not.toContain('id="jobs-timeline-selected"');
    expect(dashboardHtml).not.toContain('id="jobs-logs-selected"');
    for (const t of ['runs', 'logs', 'history']) {
      expect(dashboardHtml).toContain(`id="jobs-dtab-${t}"`);
      expect(dashboardHtml).toContain(`id="jobs-dpanel-${t}"`);
    }
    expect(dashboardHtml).toMatch(/\/admin\/batch\/runs\/:runId\/logs|runs\/:runId\/logs/i);
    expect(dashboardHtml).toMatch(/일시정지/);
    expect(dashboardHtml).toMatch(/재개/);
    expect(dashboardHtml).toMatch(/지금 실행/);
    expect(dashboardHtml).not.toMatch(/#83[34]/);
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
    expect(panelJs).toContain('pauseJob');
    expect(panelJs).toContain('runJobNow');
  });

  it('renders the jobs health summary with server-formatted human duration (#1054)', async () => {
    const h = createJobsHarness();
    await h.init();

    expect(h.elements['jobs-health-summary'].textContent).toBe(
      '스케줄러 실행 중 · 가동 1초 · 실행 작업 0건 · 대기 0건 · 오류율 0.00% · 메모리 10.0%',
    );
    expect(h.elements['jobs-health-summary'].textContent).not.toContain('uptimeMs=');
    expect(h.elements['jobs-health-summary'].textContent).not.toContain('errorRate=');
    expect(h.elements['jobs-health-summary'].textContent).not.toContain('memory%=');
  });

  it('refresh fetches stats+history and error path does not wipe prior snapshot', async () => {
    const h = createJobsHarness({
      fetchImpl: async (url: string) => {
        if (String(url).includes('/admin/batch/stats')) {
          return {
            ok: true,
            json: async () => ({
              schedulerRunning: true,
              readOnly: false,
              health: {
                memoryUsage: 10,
                runningJobs: 0,
                queueSize: 0,
                errorRate: 0,
                uptime: 1000,
                uptimeHuman: '1초',
              },
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
    expect(h.elements['jobs-drawer-job'].textContent).toBe('전체 작업');

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
      closest: (selector: string) =>
        selector === 'tr' ? { dataset: { jobName: 'cleanup' } } : null,
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
      expect(h.elements['jobs-drawer-job'].textContent).toBe('cleanup');
    });
    expect(h.elements['jobs-drawer-badge'].className).toContain('m-badge--ok');
    expect(h.elements['jobs-dtab-runs'].attributes['aria-selected']).toBe('true');
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
        closest: (selector: string) =>
          selector === 'tr' ? { dataset: { jobName: 'cleanup' } } : null,
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
      expect(h.elements['jobs-dtab-logs'].attributes['aria-selected']).toBe('true');
      expect(h.elements['jobs-dpanel-logs'].classList.contains('hidden')).toBe(false);
      expect(h.elements['jobs-dpanel-runs'].classList.contains('hidden')).toBe(true);
      expect(h.elements['jobs-drawer-run'].textContent).toContain('jr_fail');
    });
    expect(h.elements['jobs-logs-tbody'].children.length).toBeGreaterThan(0);
  });

  it('Pause / Resume / Run now require confirm before POST (#834)', async () => {
    const h = createJobsHarness({ confirmImpl: () => false });
    await h.init();

    const scheduleHandler = h.getScheduleClickHandler();
    expect(scheduleHandler).toBeTypeOf('function');

    const postCallsBefore = h.fetchMock.mock.calls.filter((c) => {
      const init = c[1] as { method?: string } | undefined;
      return init && String(init.method).toUpperCase() === 'POST';
    }).length;

    const ns = h.sandbox.__MEMENTO_JOBS_PANEL__;

    scheduleHandler!({
      target: {
        dataset: { action: 'pause', jobName: 'cleanup' },
      },
    });
    scheduleHandler!({
      target: {
        dataset: { action: 'resume', jobName: 'cleanup' },
      },
    });
    scheduleHandler!({
      target: {
        dataset: { action: 'run-now', jobName: 'cleanup' },
      },
    });
    await Promise.resolve();

    expect(h.confirmMock).toHaveBeenCalled();
    const postCallsAfter = h.fetchMock.mock.calls.filter((c) => {
      const init = c[1] as { method?: string } | undefined;
      return init && String(init.method).toUpperCase() === 'POST';
    }).length;
    expect(postCallsAfter).toBe(postCallsBefore);

    h.confirmMock.mockImplementation(() => true);

    await ns.pauseJob('cleanup');
    expect(
      h.fetchMock.mock.calls.some(
        (c) =>
          String(c[0]).includes('/admin/batch/pause') &&
          String((c[1] as { method?: string })?.method).toUpperCase() === 'POST',
      ),
    ).toBe(true);

    await ns.resumeJob('cleanup');
    expect(
      h.fetchMock.mock.calls.some(
        (c) =>
          String(c[0]).includes('/admin/batch/resume') &&
          String((c[1] as { method?: string })?.method).toUpperCase() === 'POST',
      ),
    ).toBe(true);

    await ns.runJobNow('cleanup');
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

  it('readOnly stats hide schedule row menus and timeline retry buttons (#1152)', async () => {
    const h = createJobsHarness({
      fetchImpl: async (url: string) => {
        if (String(url).includes('/admin/batch/stats')) {
          return {
            ok: true,
            json: async () => ({
              schedulerRunning: true,
              readOnly: true,
              health: {
                memoryUsage: 10,
                runningJobs: 0,
                queueSize: 0,
                errorRate: 0,
                uptime: 1000,
                uptimeHuman: '1초',
              },
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
        if (String(url).includes('/admin/batch/runs')) {
          return {
            ok: true,
            json: async () => ({
              runs: [
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
        return { ok: false, json: async () => ({}) };
      },
    });
    await h.init();

    const scheduleRows = h.elements['jobs-schedule-tbody'].children as Array<Record<string, any>>;
    expect(scheduleRows.length).toBeGreaterThan(0);
    const actionsCell = scheduleRows[0].children[scheduleRows[0].children.length - 1] as Record<
      string,
      any
    >;
    expect(actionsCell.children.length).toBe(0);

    const timelineRows = h.elements['jobs-timeline-tbody'].children as Array<Record<string, any>>;
    const failRow = timelineRows.find((r) => r.dataset && r.dataset.runId === 'jr_fail');
    expect(failRow).toBeTruthy();
    const actionsTd = failRow!.children[failRow!.children.length - 1] as Record<string, any>;
    expect((actionsTd.children || []).length).toBe(0);
  });

  it('click inside a schedule row menu does not select the job (#1152)', async () => {
    const h = createJobsHarness();
    await h.init();

    const callsBefore = h.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/admin/batch/runs?job='),
    ).length;

    h.getScheduleClickHandler()!({
      target: {
        dataset: {},
        closest: (selector: string) => (selector === '.jobs-row-menu' ? { open: true } : null),
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    const callsAfter = h.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/admin/batch/runs?job='),
    ).length;
    expect(callsAfter).toBe(callsBefore);
  });

  it('surfaces 429 as a retry hint instead of the raw HTTP line (#1158)', async () => {
    const h = createJobsHarness();
    await h.init();

    const rateLimited = {
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '900' : null) },
      json: async () => ({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded for admin_read routes. Retry after 900 seconds.',
        retry_after_seconds: 900,
      }),
    };
    h.fetchMock.mockImplementation(async () => rateLimited);

    await h.sandbox.__MEMENTO_JOBS_PANEL__.refresh();

    expect(h.elements['jobs-error'].textContent).toBe(
      '요청이 너무 많습니다 — 900초 후 다시 시도하세요.',
    );
    expect(h.elements['jobs-error'].textContent).not.toMatch(/HTTP 429/);
    expect(h.elements['jobs-error'].textContent).not.toMatch(/\/admin\/batch\/runs/);
  });

  it('reports a rate-limited write as 실패, not Too Many Requests (#1158)', async () => {
    const h = createJobsHarness();
    await h.init();

    h.fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init && String(init.method).toUpperCase() === 'POST') {
        return {
          ok: false,
          status: 429,
          headers: { get: () => '900' },
          json: async () => ({ error: 'Too Many Requests', retry_after_seconds: 900 }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    await h.sandbox.__MEMENTO_JOBS_PANEL__.runJobNow('cleanup');

    expect(h.elements['jobs-error'].textContent).toBe(
      '요청이 너무 많습니다 — 900초 후 다시 시도하세요.',
    );
    expect(h.elements['jobs-status-line'].textContent).toBe('지금 실행 cleanup 실패');
  });

  it('does not claim 완료 when the post-write refresh fails (#1158)', async () => {
    const h = createJobsHarness();
    await h.init();

    h.fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init && String(init.method).toUpperCase() === 'POST') {
        return { ok: true, json: async () => ({ message: 'ok', jobType: 'cleanup' }) };
      }
      return {
        ok: false,
        status: 429,
        headers: { get: () => '900' },
        json: async () => ({ error: 'Too Many Requests', retry_after_seconds: 900 }),
      };
    });

    await h.sandbox.__MEMENTO_JOBS_PANEL__.runJobNow('cleanup');

    expect(h.elements['jobs-status-line'].textContent).toBe(
      '지금 실행 cleanup 완료 — 화면 갱신 실패, 새로고침하세요',
    );
    expect(h.elements['jobs-error'].textContent).toBe(
      '요청이 너무 많습니다 — 900초 후 다시 시도하세요.',
    );
    expect(h.elements['jobs-loading'].classList.contains('hidden')).toBe(true);
  });
});
