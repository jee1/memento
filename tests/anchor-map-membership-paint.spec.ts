import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type Membership = { slot: string; hop_distance: number };

type Paint = {
  fill: string;
  stroke: string;
  fillOpacity: number;
  primarySlot: string | null;
  membershipLabel: string;
};

type AnchorMapNs = {
  ANCHOR_SLOT_ORDER: Record<string, number>;
  hopFillOpacity: (hopDistance: number) => number;
  rankAnchorMemberships: (anchors: Membership[] | null | undefined) => Membership[];
  resolveMemoryNodePaint: (
    anchors: Membership[] | null | undefined,
    palette: {
      slotColors: Record<string, { fill: string; stroke: string }>;
      memoryFill: string;
      memoryStroke: string;
    }
  ) => Paint;
};

const ns = {} as AnchorMapNs;

beforeAll(() => {
  (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = ns;
  const source = readFileSync(join(process.cwd(), 'static/js/anchor-map-shared.js'), 'utf-8');
  new Function(source)();
});

const palette = {
  slotColors: {
    A: { fill: 'fill-a', stroke: 'stroke-a' },
    B: { fill: 'fill-b', stroke: 'stroke-b' },
    C: { fill: 'fill-c', stroke: 'stroke-c' },
  },
  memoryFill: 'fill-neutral',
  memoryStroke: 'stroke-neutral',
};

describe('issue #1692 memory node membership paint', () => {
  it('picks the nearest membership for fill and fades by hop', () => {
    const paint = ns.resolveMemoryNodePaint(
      [
        { slot: 'C', hop_distance: 3 },
        { slot: 'A', hop_distance: 1 },
      ],
      palette
    );
    expect(paint.fill).toBe('fill-a');
    expect(paint.stroke).toBe('stroke-c');
    expect(paint.fillOpacity).toBe(1);
    expect(paint.primarySlot).toBe('A');
    expect(paint.membershipLabel).toBe('A(1홉), C(3홉)');
  });

  it('breaks hop ties with slot order A then B then C', () => {
    const ranked = ns.rankAnchorMemberships([
      { slot: 'C', hop_distance: 1 },
      { slot: 'B', hop_distance: 1 },
      { slot: 'A', hop_distance: 1 },
    ]);
    expect(ranked.map((entry) => entry.slot)).toEqual(['A', 'B', 'C']);

    const paint = ns.resolveMemoryNodePaint(ranked, palette);
    expect(paint.fill).toBe('fill-a');
    expect(paint.stroke).toBe('stroke-b');
    expect(paint.fillOpacity).toBe(1);
  });

  it('uses neutral colors when anchors is empty', () => {
    const paint = ns.resolveMemoryNodePaint([], palette);
    expect(paint).toMatchObject({
      fill: 'fill-neutral',
      stroke: 'stroke-neutral',
      fillOpacity: 1,
      primarySlot: null,
      membershipLabel: '',
    });
  });

  it('maps hop distance to fill-opacity steps 1 / 0.75 / 0.55', () => {
    expect(ns.hopFillOpacity(1)).toBe(1);
    expect(ns.hopFillOpacity(2)).toBe(0.75);
    expect(ns.hopFillOpacity(3)).toBe(0.55);
    expect(ns.resolveMemoryNodePaint([{ slot: 'B', hop_distance: 2 }], palette).fillOpacity).toBe(0.75);
  });
});
