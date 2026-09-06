/**
 * Dashboard Jobs panel smoke (#832 / specs/669-832-admin-jobs-dashboard-phase-1).
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

  it('refresh fetches stats+history and error path does not wipe prior snapshot', async () => {
    const panelJs = readJobsPanelSources();
    const elements: Record<string, any> = {};

    function el(id: string, extras: Record<string, unknown> = {}) {
      const classes = new Set<string>();
      elements[id] = {
        id,
        textContent: '',
        innerHTML: '',
        children: [] as unknown[],
        classList: {
          add: (n: string) => classes.add(n),
          remove: (n: string) => classes.delete(n),
          toggle: (n: string, force?: boolean) => {
            if (force === true) classes.add(n);
            else if (force === false) classes.delete(n);
            else if (classes.has(n)) classes.delete(n);
            else classes.add(n);
          },
          contains: (n: string) => classes.has(n),
        },
        addEventListener: vi.fn(),
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
    el('jobs-schedule-tbody', { addEventListener: vi.fn() });
    el('jobs-queue-summary');
    el('jobs-run-history-tbody');
    el('jobs-timeline-tbody');
    el('jobs-timeline-selected');
    el('jobs-health-summary');
    el('tab-jobs');

    const fetchMock = vi.fn(async (url: string) => {
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
      if (String(url).includes('/admin/batch/runs')) {
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
    });

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

    const sandbox: Record<string, any> = {
      console,
      document: {
        getElementById: (id: string) => elements[id] ?? null,
        createElement: (tag: string) => {
          const node: Record<string, unknown> = {
            tagName: tag.toUpperCase(),
            textContent: '',
            className: '',
            dataset: {},
            classList: createClassList(),
            children: [] as unknown[],
            appendChild(child: unknown) {
              (this.children as unknown[]).push(child);
              return child;
            },
            setAttribute: vi.fn(),
          };
          return node;
        },
      },
      fetch: fetchMock,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const context = vm.createContext(sandbox);
    vm.runInContext(panelJs, context, { filename: 'jobs-panel.js' });

    expect(typeof sandbox.initJobsPanel).toBe('function');
    sandbox.initJobsPanel();
    await vi.waitFor(() => {
      expect(elements['jobs-schedule-tbody'].children.length).toBeGreaterThan(0);
    });

    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/admin/batch/stats'))).toBe(true);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/admin/batch/run-history'))).toBe(
      true,
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/admin/batch/runs'))).toBe(true);
    expect(elements['jobs-timeline-tbody'].children.length).toBeGreaterThan(0);
    expect(elements['jobs-timeline-selected'].textContent).toBe('All jobs');

    const tbody = elements['jobs-schedule-tbody'];
    const priorChildCount = tbody.children.length;

    fetchMock.mockImplementation(async () => {
      throw new Error('network down');
    });

    await sandbox.__MEMENTO_JOBS_PANEL__.refresh();
    expect(tbody.children.length).toBe(priorChildCount);
    expect(elements['jobs-error'].textContent).toMatch(/network down|실패|error/i);
  });

  it('clicking a schedule row selects the job and fetches /admin/batch/runs?job= timeline (#833)', async () => {
    const panelJs = readJobsPanelSources();
    const elements: Record<string, any> = {};
    let scheduleClickHandler: ((event: unknown) => void) | null = null;

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

    function el(id: string, extras: Record<string, unknown> = {}) {
      elements[id] = {
        id,
        textContent: '',
        dataset: {},
        classList: createClassList(),
        children: [] as unknown[],
        addEventListener: vi.fn(),
        replaceChildren(...nodes: unknown[]) {
          this.children = nodes;
        },
        appendChild(child: unknown) {
          this.children.push(child);
          return child;
        },
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
    el('jobs-timeline-tbody');
    el('jobs-timeline-selected');
    el('jobs-health-summary');
    el('tab-jobs');

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/admin/batch/stats')) {
        return {
          ok: true,
          json: async () => ({
            schedulerRunning: true,
            health: { memoryUsage: 10, runningJobs: 0, queueSize: 0, errorRate: 0, uptime: 1000 },
            jobs: [{ name: 'cleanup', intervalMs: 3600000, enabled: true, lastExecution: null, totalExecutions: 1, errorCount: 0, errorRate: 0, isRunning: false }],
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
    });

    const sandbox: Record<string, any> = {
      console,
      document: {
        getElementById: (id: string) => elements[id] ?? null,
        createElement: (tag: string) => {
          const node: Record<string, unknown> = {
            tagName: tag.toUpperCase(),
            textContent: '',
            className: '',
            dataset: {},
            classList: createClassList(),
            children: [] as unknown[],
            appendChild(child: unknown) {
              (this.children as unknown[]).push(child);
              return child;
            },
            setAttribute: vi.fn(),
          };
          return node;
        },
      },
      fetch: fetchMock,
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const context = vm.createContext(sandbox);
    vm.runInContext(panelJs, context, { filename: 'jobs-panel.js' });

    sandbox.initJobsPanel();
    await vi.waitFor(() => {
      expect(elements['jobs-schedule-tbody'].children.length).toBeGreaterThan(0);
    });
    expect(typeof scheduleClickHandler).toBe('function');

    const clickedRow = { dataset: { jobName: 'cleanup' }, closest: () => ({ dataset: { jobName: 'cleanup' } }) };
    scheduleClickHandler!({ target: clickedRow });

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (c) => String(c[0]).includes('/admin/batch/runs') && String(c[0]).includes('job=cleanup'),
        ),
      ).toBe(true);
    });
    await vi.waitFor(() => {
      expect(elements['jobs-timeline-selected'].textContent).toBe('cleanup');
    });
    expect(elements['jobs-timeline-tbody'].children.length).toBeGreaterThan(0);
  });
});
