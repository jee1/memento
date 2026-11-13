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

type ShouldRunAutoFit = (
  stage: 'early' | 'end',
  flags: { userAdjustedZoom?: boolean; earlyFitDone?: boolean; endFitDone?: boolean }
) => boolean;

let computeGraphFitTransform: ComputeFit;
let shouldRunGraphAutoFitStage: ShouldRunAutoFit;

function screenPoint(node: { x: number; y: number }, fit: FitResult) {
  return { x: node.x * fit.k + fit.tx, y: node.y * fit.k + fit.ty };
}

beforeAll(() => {
  new Function(readFileSync(join(process.cwd(), 'static/js/graph-shared.js'), 'utf-8'))();
  const graph = (globalThis as Record<string, any>).__MEMENTO_GRAPH__;
  computeGraphFitTransform = graph.computeGraphFitTransform;
  shouldRunGraphAutoFitStage = graph.shouldRunGraphAutoFitStage;
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

  it('recomputes a lower scaleExtentMin when the bbox expands after early fit', () => {
    const viewport = { width: 1000, height: 800, padding: 60, maxScale: 2, minFloor: 0.1 };
    const early = computeGraphFitTransform(
      [
        { x: -5000, y: 0 },
        { x: 5000, y: 0 },
      ],
      viewport
    );
    const settled = computeGraphFitTransform(
      [
        { x: -5250, y: 0 },
        { x: 5250, y: 0 },
      ],
      viewport
    );
    expect(early).not.toBeNull();
    expect(settled).not.toBeNull();
    if (!early || !settled) {
      return;
    }
    expect(settled.kFit).toBeLessThan(early.kFit);
    expect(settled.scaleExtentMin).toBeLessThan(early.scaleExtentMin);
    expect(settled.scaleExtentMin).toBe(Math.min(0.1, settled.kFit * 0.8));
  });
});

describe('issue #1689 shouldRunGraphAutoFitStage', () => {
  it('runs early then end when the user has not zoomed', () => {
    expect(
      shouldRunGraphAutoFitStage('early', {
        userAdjustedZoom: false,
        earlyFitDone: false,
        endFitDone: false,
      })
    ).toBe(true);
    expect(
      shouldRunGraphAutoFitStage('end', {
        userAdjustedZoom: false,
        earlyFitDone: true,
        endFitDone: false,
      })
    ).toBe(true);
  });

  it('skips every stage after the user zooms or pans', () => {
    expect(
      shouldRunGraphAutoFitStage('early', {
        userAdjustedZoom: true,
        earlyFitDone: false,
        endFitDone: false,
      })
    ).toBe(false);
    expect(
      shouldRunGraphAutoFitStage('end', {
        userAdjustedZoom: true,
        earlyFitDone: true,
        endFitDone: false,
      })
    ).toBe(false);
  });

  it('does not re-run a stage that already finished', () => {
    expect(
      shouldRunGraphAutoFitStage('early', {
        userAdjustedZoom: false,
        earlyFitDone: true,
        endFitDone: false,
      })
    ).toBe(false);
    expect(
      shouldRunGraphAutoFitStage('end', {
        userAdjustedZoom: false,
        earlyFitDone: true,
        endFitDone: true,
      })
    ).toBe(false);
  });
});
