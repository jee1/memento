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
};

const WIDTH = 1000;
const HEIGHT = 800;

// The render module is a browser IIFE that registers itself on window.__MEMENTO_ANCHOR_MAP__.
// d3 and document are only touched inside functions we do not call here, so no DOM is needed.
const state = { svg: { attr: (name: string) => String(name === 'width' ? WIDTH : HEIGHT) } } as State;
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
    const { anchor, memories } = buildGraph(4);

    ns.layoutNodesByHop();

    for (const memory of memories) {
      const dx = (memory.x as number) - (anchor.fx as number);
      const dy = (memory.y as number) - (anchor.fy as number);
      expect(Math.hypot(dx, dy)).toBeCloseTo(100, 6);
    }
  });
});
