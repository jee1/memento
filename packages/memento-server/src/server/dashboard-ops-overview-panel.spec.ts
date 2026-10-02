/**
 * Dashboard Ops overview panel (#1145).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const panelJs = readFileSync(resolve(root, 'static/js/ops-overview-panel.js'), 'utf8');
const tabsPanelsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs-panels.js'), 'utf8');
const tabsInitJs = readFileSync(resolve(root, 'static/js/dashboard-tabs-init.js'), 'utf8');
const authTabsJs = readFileSync(resolve(root, 'static/js/dashboard-auth-render-tabs.js'), 'utf8');

function loadOpsOverviewApi() {
  const context: Record<string, unknown> = {
    document: { getElementById: () => null },
    console,
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(panelJs, context);
  return context.__MEMENTO_OPS_OVERVIEW__ as Record<string, (...args: unknown[]) => unknown>;
}

describe('Dashboard Ops overview panel (#1145)', () => {
  const api = loadOpsOverviewApi();

  it('reviewSeverity classifies due times', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(api.reviewSeverity('2026-10-02T11:00:00Z', now)).toBe('crit');
    expect(api.reviewSeverity('2026-10-02T12:00:00Z', now)).toBe('crit');
    expect(api.reviewSeverity('2026-10-02T14:00:00Z', now)).toBe('warn');
    expect(api.reviewSeverity('2026-10-03T12:00:00Z', now)).toBe('warn');
    expect(api.reviewSeverity('2026-10-03T12:00:01Z', now)).toBe('idle');
    expect(api.reviewSeverity('2026-10-04T12:00:00Z', now)).toBe('idle');
    expect(api.reviewSeverity('', now)).toBe('idle');
  });

  it('deltaVariant and formatDelta format queue deltas', () => {
    expect(api.deltaVariant(3)).toBe('bad');
    expect(api.formatDelta(3)).toBe('+3');
    expect(api.deltaVariant(-2)).toBe('good');
    expect(api.formatDelta(-2)).toBe('-2');
    expect(api.deltaVariant(0)).toBe('');
    expect(api.formatDelta(0)).toBe('0');
    expect(api.deltaVariant(Number.NaN)).toBe('');
    expect(api.formatDelta(Number.NaN)).toBe('');
  });

  it('nextRunAt derives the next run from last execution and interval', () => {
    const last = '2026-10-02T10:00:00.000Z';
    expect(api.nextRunAt({ enabled: true, paused: false, intervalMs: 60000, lastExecution: last })).toBe(
      Date.parse(last) + 60000,
    );
    expect(api.nextRunAt({ enabled: true, paused: true, intervalMs: 60000, lastExecution: last })).toBeNull();
    expect(api.nextRunAt({ enabled: true, paused: false, intervalMs: 0, lastExecution: last })).toBeNull();
    expect(api.nextRunAt({ enabled: true, paused: false, intervalMs: 60000, lastExecution: null })).toBeNull();
  });

  it('jobState exposes badge variants', () => {
    expect((api.jobState({ isRunning: true }) as { variant: string }).variant).toBe('ok');
    expect((api.jobState({ paused: true }) as { variant: string }).variant).toBe('idle');
    expect((api.jobState({ errorCount: 2 }) as { variant: string }).variant).toBe('warn');
    expect((api.jobState({ errorCount: 0 }) as { variant: string }).variant).toBe('ok');
  });

  it('pickJobs returns the soonest three jobs and sorts null next runs last', () => {
    const base = Date.parse('2026-10-02T10:00:00.000Z');
    const jobs = [
      { name: 'z-late', enabled: true, paused: false, intervalMs: 60000, lastExecution: new Date(base).toISOString() },
      { name: 'a-soon', enabled: true, paused: false, intervalMs: 1000, lastExecution: new Date(base).toISOString() },
      { name: 'b-mid', enabled: true, paused: false, intervalMs: 30000, lastExecution: new Date(base).toISOString() },
      { name: 'c-null', enabled: false, paused: true, intervalMs: 60000, lastExecution: new Date(base).toISOString() },
    ];
    const picked = api.pickJobs(jobs, 3) as Array<{ name: string }>;
    expect(picked.map((job) => job.name)).toEqual(['a-soon', 'b-mid', 'z-late']);
  });

  it('typeShares skips zero counts and rounds percentages', () => {
    expect(
      api.typeShares([
        { type: 'episodic', total_count: 60 },
        { type: 'semantic', total_count: 40 },
        { type: 'working', total_count: 0 },
      ]),
    ).toEqual([
      { type: 'episodic', count: 60, pct: 60 },
      { type: 'semantic', count: 40, pct: 40 },
    ]);
    expect(api.typeShares([])).toEqual([]);
  });

  it('slotNeighborhood counts hop buckets from reachable memory nodes', () => {
    const map = {
      nodes: [
        { id: 'a', type: 'anchor', slot: 'A', content: 'anchor A' },
        { id: 'm1', type: 'memory', hop_distance: 1, content: 'm1' },
        { id: 'm2', type: 'memory', hop_distance: 2, content: 'm2' },
        { id: 'b', type: 'anchor', slot: 'B', content: 'anchor B' },
        { id: 'm3', type: 'memory', hop_distance: 1, content: 'm3' },
      ],
      links: [
        { source: 'a', target: 'm1' },
        { source: 'm1', target: 'm2' },
        { source: 'b', target: 'm3' },
        { source: 'b', target: 'm1' },
      ],
      anchors: [],
    };
    const neighborhood = api.slotNeighborhood(map, 'A') as {
      anchor: { id: string };
      hops: Record<number, number>;
    };
    expect(neighborhood.anchor.id).toBe('a');
    expect(neighborhood.hops).toEqual({ 1: 1, 2: 1, 3: 0 });
    expect((api.slotNeighborhood(map, 'B') as { hops: Record<number, number> }).hops).toEqual({
      1: 2,
      2: 1,
      3: 0,
    });

    const objectLinks = {
      nodes: map.nodes,
      links: [
        { source: { id: 'a' }, target: { id: 'm1' } },
        { source: { id: 'm1' }, target: { id: 'm2' } },
      ],
      anchors: [],
    };
    expect((api.slotNeighborhood(objectLinks, 'A') as { hops: Record<number, number> }).hops).toEqual({
      1: 1,
      2: 1,
      3: 0,
    });
    expect(api.slotNeighborhood(map, 'C')).toBeNull();
  });

  it('formatClock uses HH:MM for today and MM-DD HH:MM otherwise', () => {
    const now = Date.now();
    const nowDate = new Date(now);
    const sameDay = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate(),
      9,
      5,
      0,
    ).getTime();
    const otherDay = sameDay - 24 * 60 * 60 * 1000;
    expect(api.formatClock(sameDay, now)).toMatch(/^\d{2}:\d{2}$/);
    expect(api.formatClock(otherDay, now)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('wires dashboard markup, tabs, and panel contracts', () => {
    const opsOverviewIdx = dashboardHtml.indexOf('data-tab="ops-overview"');
    const opsStatusIdx = dashboardHtml.indexOf('data-tab="ops-status"');
    const graphIdx = dashboardHtml.indexOf('data-tab="graph"');
    expect(dashboardHtml).toContain('id="dashboard-tab-ops-overview"');
    expect(opsOverviewIdx).toBeGreaterThan(graphIdx);
    expect(opsOverviewIdx).toBeLessThan(opsStatusIdx);
    expect(dashboardHtml).toContain('id="tab-ops-overview"');
    expect(dashboardHtml).toContain('aria-labelledby="dashboard-tab-ops-overview"');
    expect(dashboardHtml).toContain('/static/js/ops-overview-panel.js');
    expect(tabsPanelsJs).toContain("'ops-overview'");
    expect(tabsInitJs).toContain('initOpsOverviewPanel');
    expect(dashboardHtml).toContain('id="dashboard-tab-anchor" class="m-tab-btn active session-only"');
    expect(authTabsJs).toContain("activateTab('anchor')");
  });

  it('panel source uses shared primitives and keeps Korean inside S only', () => {
    expect(panelJs).toContain('m-loading');
    expect(panelJs).toContain('m-empty');
    expect(panelJs).toContain('m-error');
    expect(panelJs).toContain('m-stat');
    expect(panelJs).toContain('m-badge--');
    expect(panelJs).toContain('m-sparkline');
    expect(panelJs).toContain('shares.length === 0');
    expect(panelJs).not.toContain('innerHTML');

    const sBlockEnd = panelJs.indexOf('\n  };\n');
    expect(sBlockEnd).toBeGreaterThan(0);
    const afterS = panelJs.slice(sBlockEnd + '\n  };\n'.length);
    expect(afterS).not.toMatch(/[가-힣]/);
  });
});
