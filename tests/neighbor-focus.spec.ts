import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type Endpoint = string | { id: string };
type Edge = { source: Endpoint; target: Endpoint };

let endpointId: (endpoint: Endpoint) => string;
let collectKeepIds: (focusId: string, edges: Edge[]) => Set<string>;
let edgeTouchesKeep: (edge: Edge, keepIds: Set<string>) => boolean;

beforeAll(() => {
  new Function(readFileSync(join(process.cwd(), 'static/js/neighbor-focus.js'), 'utf-8'))();
  const api = (globalThis as Record<string, any>).__MEMENTO_NEIGHBOR_FOCUS__;
  endpointId = api.endpointId;
  collectKeepIds = api.collectKeepIds;
  edgeTouchesKeep = api.edgeTouchesKeep;
});

describe('neighbor focus keep set', () => {
  const line: Edge[] = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ];

  it('keeps the focus node and both one-hop neighbors on a line', () => {
    expect(collectKeepIds('b', line)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('keeps only the focus node and its single neighbor at a line end', () => {
    expect(collectKeepIds('a', line)).toEqual(new Set(['a', 'b']));
  });

  it('keeps an edge only when both endpoints are in the keep set', () => {
    const keep = collectKeepIds('a', line);

    expect(edgeTouchesKeep(line[0], keep)).toBe(true);
    expect(edgeTouchesKeep(line[1], keep)).toBe(false);
    expect(edgeTouchesKeep({ source: 'c', target: 'd' }, keep)).toBe(false);
  });

  it('reads object.id the same as a string endpoint', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };

    expect(endpointId('a')).toBe('a');
    expect(endpointId(a)).toBe('a');
    expect(collectKeepIds('a', [{ source: a, target: b }])).toEqual(new Set(['a', 'b']));
    expect(edgeTouchesKeep({ source: a, target: b }, new Set(['a', 'b']))).toBe(true);
    expect(edgeTouchesKeep({ source: a, target: b }, new Set(['b']))).toBe(false);
  });
});
