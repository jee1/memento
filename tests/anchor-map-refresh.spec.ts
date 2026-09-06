import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type MapData = {
  agent_id: string;
  anchors: unknown[];
  nodes: Array<{ id: string; similarity?: number }>;
  links: unknown[];
  timestamp: string;
};

// anchor-map-data.js is a browser IIFE; hasMapDataChanged is pure, so a stubbed namespace is enough.
const ns = { state: {} } as { state: Record<string, unknown>; hasMapDataChanged: (a: unknown, b: unknown) => boolean };

beforeAll(() => {
  (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = ns;
  new Function(readFileSync(join(process.cwd(), 'static/js/anchor-map-data.js'), 'utf-8'))();
});

function buildMapData(overrides: Partial<MapData> = {}): MapData {
  return {
    agent_id: 'default',
    anchors: [{ agent_id: 'default', slot: 'A', memory_id: 'mem-1' }],
    nodes: [{ id: 'mem-1', similarity: 1 }],
    links: [{ source: 'mem-1', target: 'mem-2', type: 'hop' }],
    timestamp: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('issue #870 anchor map change detection', () => {
  it('treats a response that only differs by timestamp as unchanged', () => {
    const previous = buildMapData();
    const next = buildMapData({ timestamp: '2026-09-06T00:00:10.000Z' });

    expect(ns.hasMapDataChanged(previous, next)).toBe(false);
  });

  it('detects content changes that keep the same node and link counts', () => {
    const previous = buildMapData();
    const next = buildMapData({ nodes: [{ id: 'mem-99', similarity: 1 }] });

    expect(ns.hasMapDataChanged(previous, next)).toBe(true);
  });

  it('treats a missing previous snapshot as changed', () => {
    expect(ns.hasMapDataChanged(null, buildMapData())).toBe(true);
  });
});
