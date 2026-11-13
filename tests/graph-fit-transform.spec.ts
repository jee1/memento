/**
 * Memory graph fit transform (issue 1689).
 * Loads the pure helper from static/js/graph-shared.js in a vm-like sandbox
 * (new Function / globalThis) so bbox → transform needs no DOM.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type FitNode = { x?: number; y?: number };
type FitResult = {
  k: number;
  kFit: number;
  tx: number;
  ty: number;
  scaleExtentMin: number;
};

type ComputeFit = (
  nodes: FitNode[] | undefined,
  viewport: {
    width: number;
    height: number;
    padding?: number;
    maxScale?: number;
    minFloor?: number;
  }
) => FitResult | null;

let computeGraphFitTransform: ComputeFit;

function screenPoint(node: { x: number; y: number }, fit: FitResult) {
  return { x: node.x * fit.k + fit.tx, y: node.y * fit.k + fit.ty };
}

beforeAll(() => {
  new Function(readFileSync(join(process.cwd(), 'static/js/graph-shared.js'), 'utf-8'))();
  computeGraphFitTransform = (globalThis as Record<string, any>).__MEMENTO_GRAPH__
    .computeGraphFitTransform;
});

describe('issue #1689 computeGraphFitTransform', () => {
  it('fits a wide bbox so every node lands inside the viewport (with padding)', () => {
    const width = 800;
    const height = 600;
    const padding = 60;
    const nodes = [
      { x: -5000, y: -4000 },
      { x: 5000, y: -4000 },
      { x: -5000, y: 4000 },
      { x: 5000, y: 4000 },
      { x: 0, y: 0 },
    ];

    const fit = computeGraphFitTransform(nodes, { width, height, padding, maxScale: 2, minFloor: 0.1 });
    expect(fit).not.toBeNull();
    if (!fit) {
      return;
    }

    expect(fit.k).toBeLessThan(0.1);
    expect(fit.scaleExtentMin).toBe(Math.min(0.1, fit.kFit * 0.8));
    expect(fit.scaleExtentMin).toBeLessThan(0.1);

    for (const node of nodes) {
      const screen = screenPoint(node, fit);
      expect(screen.x).toBeGreaterThanOrEqual(0);
      expect(screen.x).toBeLessThanOrEqual(width);
      expect(screen.y).toBeGreaterThanOrEqual(0);
      expect(screen.y).toBeLessThanOrEqual(height);
    }
  });

  it('caps scale for a few tightly clustered nodes (maxScale)', () => {
    const fit = computeGraphFitTransform(
      [
        { x: 390, y: 290 },
        { x: 410, y: 310 },
      ],
      { width: 800, height: 600, padding: 60, maxScale: 2, minFloor: 0.1 }
    );
    expect(fit).not.toBeNull();
    if (!fit) {
      return;
    }
    expect(fit.k).toBeLessThanOrEqual(2);
    expect(fit.kFit).toBe(fit.k);
  });

  it('returns null for zero placed nodes', () => {
    expect(computeGraphFitTransform([], { width: 800, height: 600 })).toBeNull();
    expect(
      computeGraphFitTransform([{ x: Number.NaN, y: 1 }], { width: 800, height: 600 })
    ).toBeNull();
  });

  it('fits a single node without exceeding maxScale', () => {
    const width = 800;
    const height = 600;
    const fit = computeGraphFitTransform([{ x: 100, y: 200 }], {
      width,
      height,
      padding: 60,
      maxScale: 2,
      minFloor: 0.1,
    });
    expect(fit).not.toBeNull();
    if (!fit) {
      return;
    }
    expect(fit.k).toBeLessThanOrEqual(2);
    const screen = screenPoint({ x: 100, y: 200 }, fit);
    expect(screen.x).toBeCloseTo(width / 2, 5);
    expect(screen.y).toBeCloseTo(height / 2, 5);
  });

  it('sets scaleExtentMin to min(0.1, kFit * 0.8)', () => {
    const wide = computeGraphFitTransform(
      [
        { x: 0, y: 0 },
        { x: 20000, y: 15000 },
      ],
      { width: 1000, height: 800, padding: 60, maxScale: 2, minFloor: 0.1 }
    );
    expect(wide).not.toBeNull();
    if (!wide) {
      return;
    }
    expect(wide.scaleExtentMin).toBe(Math.min(0.1, wide.kFit * 0.8));

    const tight = computeGraphFitTransform(
      [
        { x: 100, y: 100 },
        { x: 120, y: 120 },
      ],
      { width: 1000, height: 800, padding: 60, maxScale: 2, minFloor: 0.1 }
    );
    expect(tight).not.toBeNull();
    if (!tight) {
      return;
    }
    expect(tight.kFit).toBeGreaterThan(0.1);
    expect(tight.scaleExtentMin).toBe(0.1);
  });
});
