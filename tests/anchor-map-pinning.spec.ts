import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type LayoutNs = {
  LAYOUT_STORAGE_KEY: string;
  LAYOUT_SCHEMA_VERSION: number;
  LAYOUT_MAX_AGENTS: number;
  LAYOUT_MAX_NODES_PER_AGENT: number;
  LAYOUT_MAX_BYTES: number;
  LAYOUT_DEFAULT_DISTANCE: number;
  LAYOUT_HOP_DISTANCE: Record<number, number>;
  hopLinkDistance: (link: Record<string, unknown>) => number;
  mergeNodeLayout: (
    nextRawNodes: Array<Record<string, unknown>>,
    previousNodes: Array<Record<string, unknown>> | null,
    storedNodes: Record<string, { x: number; y: number; pinned?: boolean }> | null,
  ) => { nodes: Array<Record<string, unknown>>; removedIds: string[] };
  readStoredLayout: (storage: StorageLike) => { version: number; agents: Record<string, unknown> };
  readAgentLayout: (storage: StorageLike, agentId: string) => Record<string, unknown>;
  buildAgentEntry: (pinnedNodes: Array<Record<string, unknown>>, now?: number) => {
    updated_at: number;
    nodes: Record<string, { x: number; y: number; pinned: boolean }>;
  };
  enforceLayoutCaps: (
    doc: { version: number; agents: Record<string, AgentEntry> },
    currentAgentId: string,
  ) => { version: number; agents: Record<string, AgentEntry> };
  writeAgentLayout: (
    storage: StorageLike,
    agentId: string,
    pinnedNodes: Array<Record<string, unknown>>,
  ) => { ok: boolean; reason?: string };
  pruneAgentNodes: (entry: AgentEntry, liveIds: string[] | Set<string>) => AgentEntry;
  clearAgentLayout: (storage: StorageLike, agentId: string) => { ok: boolean };
};

type AgentEntry = {
  updated_at: number;
  nodes: Record<string, { x: number; y: number; pinned: boolean }>;
};

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function makeStorage(opts: { throwOnSet?: number; throwOnGet?: boolean } = {}) {
  const store = new Map<string, string>();
  let sets = 0;
  return {
    store,
    getItem: (k: string) => {
      if (opts.throwOnGet) throw new Error('SecurityError');
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      sets += 1;
      if (opts.throwOnSet && sets <= opts.throwOnSet) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  };
}

const ns = {} as LayoutNs;

beforeAll(() => {
  (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = ns;
  const source = readFileSync(join(process.cwd(), 'static/js/anchor-map-layout.js'), 'utf-8');
  new Function(source)();
});

describe('issue #894 anchor map layout pinning helpers', () => {
  it('merge keeps geometry/pin from previous and server fields from payload', () => {
    const { nodes } = ns.mergeNodeLayout(
      [{ id: 'mem-a', content: 'new', similarity: 0.9, hop_distance: 2 }],
      [{ id: 'mem-a', content: 'old', similarity: 0.1, x: 10, y: 20, vx: 1, vy: 2, fx: 10, fy: 20, pinned: true }],
      {},
    );
    expect(nodes[0]).toMatchObject({
      id: 'mem-a',
      content: 'new',
      similarity: 0.9,
      hop_distance: 2,
      x: 10,
      y: 20,
      vx: 1,
      vy: 2,
      fx: 10,
      fy: 20,
      pinned: true,
    });
  });

  it('merge restores stored pinned node with fx/fy', () => {
    const { nodes } = ns.mergeNodeLayout(
      [{ id: 'mem-a', content: 'c' }],
      [],
      { 'mem-a': { x: 100, y: 200, pinned: true } },
    );
    expect(nodes[0]).toMatchObject({ x: 100, y: 200, pinned: true, fx: 100, fy: 200 });
  });

  it('merge restores stored unpinned node without fx/fy', () => {
    const { nodes } = ns.mergeNodeLayout(
      [{ id: 'mem-a', content: 'c' }],
      [],
      { 'mem-a': { x: 100, y: 200, pinned: false } },
    );
    expect(nodes[0].x).toBe(100);
    expect(nodes[0].y).toBe(200);
    expect(nodes[0].pinned).toBe(false);
    expect(nodes[0].fx).toBeUndefined();
    expect(nodes[0].fy).toBeUndefined();
  });

  it('merge ignores non-finite stored coordinates', () => {
    const { nodes } = ns.mergeNodeLayout(
      [{ id: 'mem-a', content: 'c' }],
      [],
      { 'mem-a': { x: Number.NaN, y: 200, pinned: true } },
    );
    expect(nodes[0].x).toBeUndefined();
    expect(nodes[0].pinned).toBeUndefined();
  });

  it('merge lists removed ids that are absent from the new payload', () => {
    const result = ns.mergeNodeLayout(
      [{ id: 'keep' }],
      [{ id: 'gone-prev', x: 1, y: 2 }],
      { 'gone-stored': { x: 3, y: 4, pinned: true } },
    );
    expect(result.nodes.map((n) => n.id)).toEqual(['keep']);
    expect(result.removedIds.sort()).toEqual(['gone-prev', 'gone-stored']);
  });

  it('merge leaves brand-new nodes without coordinates', () => {
    const result = ns.mergeNodeLayout([{ id: 'fresh' }], [], {});
    expect(result.nodes[0].x).toBeUndefined();
    expect(result.removedIds).toEqual([]);
  });

  it('readStoredLayout rejects foreign schema versions', () => {
    const storage = makeStorage();
    storage.setItem(ns.LAYOUT_STORAGE_KEY, JSON.stringify({ version: 2, agents: { a: {} } }));
    expect(ns.readStoredLayout(storage)).toEqual({ version: 1, agents: {} });
  });

  it('readStoredLayout tolerates corrupt payloads', () => {
    const storage = makeStorage();
    storage.setItem(ns.LAYOUT_STORAGE_KEY, '{not-json');
    expect(ns.readStoredLayout(storage)).toEqual({ version: 1, agents: {} });
    storage.setItem(ns.LAYOUT_STORAGE_KEY, 'null');
    expect(ns.readStoredLayout(storage)).toEqual({ version: 1, agents: {} });
    storage.setItem(ns.LAYOUT_STORAGE_KEY, '[]');
    expect(ns.readStoredLayout(storage)).toEqual({ version: 1, agents: {} });
  });

  it('write/read round-trip stores only pinned nodes with 1-decimal coords', () => {
    const storage = makeStorage();
    const result = ns.writeAgentLayout(storage, 'default', [
      { id: 'p1', x: 10.14, y: 20.16, pinned: true },
      { id: 'free', x: 1, y: 2, pinned: false },
    ]);
    expect(result.ok).toBe(true);
    const nodes = ns.readAgentLayout(storage, 'default') as Record<string, { x: number; y: number; pinned: boolean }>;
    expect(Object.keys(nodes)).toEqual(['p1']);
    expect(nodes.p1).toEqual({ x: 10.1, y: 20.2, pinned: true });
  });

  it('caps nodes per agent at 300 and drops the earliest keys', () => {
    const storage = makeStorage();
    const pinned = Array.from({ length: 301 }, (_, i) => ({
      id: 'n' + i,
      x: i,
      y: i,
      pinned: true,
    }));
    ns.writeAgentLayout(storage, 'default', pinned);
    const nodes = ns.readAgentLayout(storage, 'default');
    expect(Object.keys(nodes)).toHaveLength(300);
    expect(nodes['n0']).toBeUndefined();
    expect(nodes['n300']).toBeDefined();
  });

  it('keeps at most 5 agents and never evicts the current agent', () => {
    const storage = makeStorage();
    for (let i = 0; i < 5; i += 1) {
      const doc = ns.readStoredLayout(storage);
      (doc.agents as Record<string, AgentEntry>)['old-' + i] = {
        updated_at: 1000 + i,
        nodes: { a: { x: 1, y: 1, pinned: true } },
      };
      storage.setItem(ns.LAYOUT_STORAGE_KEY, JSON.stringify(doc));
    }
    ns.writeAgentLayout(storage, 'current', [{ id: 'c', x: 5, y: 5, pinned: true }]);
    const agents = Object.keys(ns.readStoredLayout(storage).agents as Record<string, unknown>);
    expect(agents).toHaveLength(5);
    expect(agents).toContain('current');
    expect(agents).not.toContain('old-0');
  });

  it('evicts other agents when the serialized size exceeds the byte cap', () => {
    const original = ns.LAYOUT_MAX_BYTES;
    (ns as { LAYOUT_MAX_BYTES: number }).LAYOUT_MAX_BYTES = 400;
    try {
      const storage = makeStorage();
      const fat = 'x'.repeat(80);
      for (let i = 0; i < 4; i += 1) {
        const doc = ns.readStoredLayout(storage);
        (doc.agents as Record<string, AgentEntry>)['fat-' + i] = {
          updated_at: i,
          nodes: { [fat + i]: { x: 1, y: 1, pinned: true } },
        };
        storage.setItem(ns.LAYOUT_STORAGE_KEY, JSON.stringify(doc));
      }
      ns.writeAgentLayout(storage, 'current', [{ id: 'c', x: 1, y: 1, pinned: true }]);
      const agents = Object.keys(ns.readStoredLayout(storage).agents as Record<string, unknown>);
      expect(agents).toContain('current');
      expect(agents.length).toBeLessThanOrEqual(5);
    } finally {
      (ns as { LAYOUT_MAX_BYTES: number }).LAYOUT_MAX_BYTES = original;
    }
  });

  it('retries after one QuotaExceededError and succeeds', () => {
    const storage = makeStorage({ throwOnSet: 1 });
    const result = ns.writeAgentLayout(storage, 'default', [
      { id: 'p1', x: 1, y: 2, pinned: true },
    ]);
    expect(result).toEqual({ ok: true });
    expect(ns.readAgentLayout(storage, 'default').p1).toBeDefined();
  });

  it('returns quota failure when setItem always throws', () => {
    const storage = makeStorage({ throwOnSet: 999 });
    const result = ns.writeAgentLayout(storage, 'default', [
      { id: 'p1', x: 1, y: 2, pinned: true },
    ]);
    expect(result).toEqual({ ok: false, reason: 'quota' });
  });

  it('readStoredLayout returns empty doc when getItem throws', () => {
    const storage = makeStorage({ throwOnGet: true });
    expect(ns.readStoredLayout(storage)).toEqual({ version: 1, agents: {} });
  });

  it('pruneAgentNodes drops ids outside the live set', () => {
    const entry = {
      updated_at: 1,
      nodes: {
        keep: { x: 1, y: 1, pinned: true },
        drop: { x: 2, y: 2, pinned: true },
      },
    };
    const pruned = ns.pruneAgentNodes(entry, ['keep']);
    expect(pruned.nodes).toEqual({ keep: { x: 1, y: 1, pinned: true } });
  });

  it('clearAgentLayout removes only the named agent', () => {
    const storage = makeStorage();
    ns.writeAgentLayout(storage, 'a', [{ id: '1', x: 1, y: 1, pinned: true }]);
    ns.writeAgentLayout(storage, 'b', [{ id: '2', x: 2, y: 2, pinned: true }]);
    ns.clearAgentLayout(storage, 'a');
    const doc = ns.readStoredLayout(storage);
    expect(doc.agents).not.toHaveProperty('a');
    expect(doc.agents).toHaveProperty('b');
  });

  it('hopLinkDistance grows with hop and falls back for unknown hops', () => {
    expect(ns.hopLinkDistance({ hop_distance: 1 }))
      .toBeLessThan(ns.hopLinkDistance({ hop_distance: 2 }));
    expect(ns.hopLinkDistance({ hop_distance: 2 }))
      .toBeLessThan(ns.hopLinkDistance({ hop_distance: 3 }));
    expect(ns.hopLinkDistance({})).toBe(ns.LAYOUT_DEFAULT_DISTANCE);
    expect(ns.hopLinkDistance({ target: { hop_distance: 2 } })).toBe(ns.LAYOUT_HOP_DISTANCE[2]);
  });
});
