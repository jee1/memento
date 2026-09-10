import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type GraphNode = { id: string };
type GraphEdge = { id: string; source: string | GraphNode; target: string | GraphNode };
type FilterResult = { nodes: GraphNode[]; edges: GraphEdge[]; hiddenCount: number };

let filterConnectedNodes: (nodes: GraphNode[] | undefined, edges: GraphEdge[] | undefined) => FilterResult;

beforeAll(() => {
  // graph-shared.js 는 브라우저 IIFE 이지만 본문에서 DOM 을 만지지 않는다.
  new Function(readFileSync(join(process.cwd(), 'static/js/graph-shared.js'), 'utf-8'))();
  filterConnectedNodes = (globalThis as Record<string, any>).__MEMENTO_GRAPH__.filterConnectedNodes;
});

describe('issue #836 filterConnectedNodes (View orphan)', () => {
  it('excludes degree-0 nodes only', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const edges = [{ id: 'e1', source: 'a', target: 'b' }];

    const result = filterConnectedNodes(nodes, edges);

    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.nodes).toHaveLength(2);
    expect(result.hiddenCount).toBe(2);
    expect(result.edges).toHaveLength(1);
  });

  it('hides all nodes when there are zero edges', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = filterConnectedNodes(nodes, []);

    expect(result.nodes).toHaveLength(0);
    expect(result.hiddenCount).toBe(3);
    expect(result.edges).toHaveLength(0);
  });

  it('keeps a fully connected component intact', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];

    const result = filterConnectedNodes(nodes, edges);

    expect(result.nodes).toHaveLength(3);
    expect(result.hiddenCount).toBe(0);
    expect(result.edges).toHaveLength(2);
  });

  it('accepts d3-mutated object endpoints the same as string ids', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const c = { id: 'c' };
    const nodes = [a, b, c];
    const stringEdges = [{ id: 'e1', source: 'a', target: 'b' }];
    const objectEdges = [{ id: 'e1', source: a, target: b }];

    const fromStrings = filterConnectedNodes(nodes, stringEdges);
    const fromObjects = filterConnectedNodes(nodes, objectEdges);

    expect(fromObjects.nodes.map((n) => n.id)).toEqual(fromStrings.nodes.map((n) => n.id));
    expect(fromObjects.hiddenCount).toBe(fromStrings.hiddenCount);
    expect(fromObjects.edges).toHaveLength(fromStrings.edges.length);
  });

  it('drops dangling edges and does not count their endpoints as connected', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const edges = [
      { id: 'ok', source: 'a', target: 'b' },
      { id: 'dangle', source: 'a', target: 'missing' },
    ];

    const result = filterConnectedNodes(nodes, edges);

    expect(result.edges.map((e) => e.id)).toEqual(['ok']);
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.hiddenCount).toBe(0);
  });

  it('keeps a self-loop node (degree >= 1)', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const edges = [{ id: 'loop', source: 'a', target: 'a' }];

    const result = filterConnectedNodes(nodes, edges);

    expect(result.nodes.map((n) => n.id)).toEqual(['a']);
    expect(result.hiddenCount).toBe(1);
    expect(result.edges).toHaveLength(1);
  });

  it('returns empty result for undefined inputs', () => {
    const result = filterConnectedNodes(undefined, undefined);

    expect(result).toEqual({ nodes: [], edges: [], hiddenCount: 0 });
  });
});
