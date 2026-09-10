import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type Node = {
  id: string;
  type: 'anchor' | 'memory';
  hop_distance?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

type State = {
  svg: { attr: (name: string) => string };
  nodes: Node[];
  links: Array<{ source: Node; target: Node }>;
  layoutMode?: 'auto' | 'paused';
};

const WIDTH = 1000;
const HEIGHT = 800;

// The render module is a browser IIFE that registers itself on window.__MEMENTO_ANCHOR_MAP__.
// d3 and document are only touched inside functions we do not call here, so no DOM is needed.
const state = {
  svg: { attr: (name: string) => String(name === 'width' ? WIDTH : HEIGHT) },
  layoutMode: 'auto' as const,
} as State;
const ns = { state, escapeHtml: (value: unknown) => String(value) } as {
  state: State;
  escapeHtml: (value: unknown) => string;
  layoutNodesByHop: () => void;
};

beforeAll(() => {
  (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = ns;
  const source = readFileSync(join(process.cwd(), 'static/js/anchor-map-render.js'), 'utf-8');
  new Function(source)();
});

function buildGraph(memoryCount: number): { anchor: Node; memories: Node[] } {
  const anchor: Node = { id: 'anchor-a', type: 'anchor' };
  const memories: Node[] = Array.from({ length: memoryCount }, (_, index) => ({
    id: 'mem-' + index,
    type: 'memory',
    hop_distance: 1,
  }));
  state.nodes = [anchor, ...memories];
  state.links = memories.map((memory) => ({ source: anchor, target: memory }));
  return { anchor, memories };
}

describe('issue #867 anchor map hop layout', () => {
  it('pins anchors only and leaves memory nodes free for the force simulation', () => {
    state.layoutMode = 'auto';
    const { anchor, memories } = buildGraph(20);

    ns.layoutNodesByHop();

    expect(anchor.fx).toBeTypeOf('number');
    expect(anchor.fy).toBeTypeOf('number');
    const pinned = state.nodes.filter((node) => node.fx != null || node.fy != null);
    expect(pinned).toEqual([anchor]);
    for (const memory of memories) {
      expect(memory.x).toBeTypeOf('number');
      expect(memory.y).toBeTypeOf('number');
    }
  });

  it('seeds hop-1 memories on the ring around their anchor', () => {
    state.layoutMode = 'auto';
    const { anchor, memories } = buildGraph(4);

    ns.layoutNodesByHop();

    for (const memory of memories) {
      const dx = (memory.x as number) - (anchor.fx as number);
      const dy = (memory.y as number) - (anchor.fy as number);
      expect(Math.hypot(dx, dy)).toBeCloseTo(100, 6);
    }
  });
});

describe('issue #894 hop layout respects paused mode and existing coordinates', () => {
  it('does not mutate coordinates while layoutMode is paused', () => {
    state.layoutMode = 'auto';
    const { anchor, memories } = buildGraph(3);
    ns.layoutNodesByHop();
    const before = JSON.parse(JSON.stringify(state.nodes.map((n) => ({
      id: n.id, x: n.x, y: n.y, fx: n.fx, fy: n.fy,
    }))));

    state.layoutMode = 'paused';
    ns.layoutNodesByHop();

    expect(state.nodes.map((n) => ({
      id: n.id, x: n.x, y: n.y, fx: n.fx, fy: n.fy,
    }))).toEqual(before);
    expect(anchor).toBeTruthy();
    expect(memories).toHaveLength(3);
  });

  it('does not overwrite memory nodes that already have x/y', () => {
    state.layoutMode = 'auto';
    const { memories } = buildGraph(2);
    memories[0].x = 42;
    memories[0].y = 43;
    ns.layoutNodesByHop();
    expect(memories[0].x).toBe(42);
    expect(memories[0].y).toBe(43);
    expect(memories[1].x).toBeTypeOf('number');
  });

  it('does not recalculate fx/fy for pinned anchors', () => {
    state.layoutMode = 'auto';
    const { anchor } = buildGraph(1);
    (anchor as Node & { pinned?: boolean }).pinned = true;
    anchor.fx = 11;
    anchor.fy = 22;
    ns.layoutNodesByHop();
    expect(anchor.fx).toBe(11);
    expect(anchor.fy).toBe(22);
  });
});
