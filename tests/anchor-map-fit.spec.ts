import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

type Node = { id: string; x?: number; y?: number };
type Transform = { x: number; y: number; k: number };

const WIDTH = 1000;
const HEIGHT = 800;

let applied: Transform | null = null;

// zoomIdentity.translate(x, y).scale(k) — d3의 체이닝만 흉내내면 충분하다.
const zoomIdentity = {
  translate(x: number, y: number) {
    return {
      scale(k: number): Transform {
        return { x, y, k };
      },
    };
  },
};

const state = {
  svg: {
    attr: (name: string) => String(name === 'width' ? WIDTH : HEIGHT),
    transition: () => ({
      duration: () => ({
        call: (_behavior: unknown, transform: Transform) => {
          applied = transform;
        },
      }),
    }),
  },
  zoomBehavior: { transform: {} },
  nodes: [] as Node[],
};

const ns = {
  state,
  escapeHtml: (value: unknown) => String(value),
  debugAnchorMap: () => undefined,
} as unknown as { state: typeof state; fitToNodes: () => void };

beforeAll(() => {
  (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = ns;
  (globalThis as Record<string, unknown>).d3 = { zoomIdentity };
  new Function(readFileSync(join(process.cwd(), 'static/js/anchor-map-render.js'), 'utf-8'))();
});

beforeEach(() => {
  applied = null;
});

describe('issue #874 anchor map zoom-to-fit', () => {
  it('centers the node bounding box on the canvas', () => {
    state.nodes = [
      { id: 'a', x: 100, y: 200 },
      { id: 'b', x: 500, y: 600 },
    ];

    ns.fitToNodes();

    // bbox 중심 (300, 400) 이 캔버스 중심으로 와야 한다
    expect(applied).not.toBeNull();
    const transform = applied as unknown as Transform;
    expect(transform.x + 300 * transform.k).toBeCloseTo(WIDTH / 2, 6);
    expect(transform.y + 400 * transform.k).toBeCloseTo(HEIGHT / 2, 6);
  });

  it('shrinks far-apart nodes to fit and never zooms past 2x', () => {
    state.nodes = [
      { id: 'a', x: -2000, y: -2000 },
      { id: 'b', x: 2000, y: 2000 },
    ];
    ns.fitToNodes();
    const wide = applied as unknown as Transform;
    expect(wide.k).toBeLessThan(1);

    state.nodes = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 1, y: 1 },
    ];
    ns.fitToNodes();
    const tight = applied as unknown as Transform;
    expect(tight.k).toBe(2);
  });

  it('does nothing when no node has a position yet', () => {
    state.nodes = [{ id: 'a' }];

    ns.fitToNodes();

    expect(applied).toBeNull();
  });
});
