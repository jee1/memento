import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type GraphNode = { id: string };
type GraphEdge = { id: string; source: string | GraphNode; target: string | GraphNode };

let trimToLocalDepth: (
  nodes: GraphNode[],
  edges: GraphEdge[],
  focusId: string | null | undefined,
  depth: number,
) => { nodes: GraphNode[]; edges: GraphEdge[] };

let ns: {
  trimToLocalDepth: typeof trimToLocalDepth;
  renderVisibleGraph: () => void;
  state: {
    rawGraphNodes: GraphNode[] | null;
    rawGraphEdges: GraphEdge[] | null;
    lastGraphNodes: GraphNode[] | null;
    localMode: boolean;
    localFocusId: string | null;
    localDepth: number;
  };
  dom: { orphanToggle: { checked: boolean } };
  renderGraph: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  showEmpty: (visible: boolean) => void;
};

beforeAll(() => {
  new Function(readFileSync(join(process.cwd(), 'static/js/graph-shared.js'), 'utf-8'))();
  new Function(readFileSync(join(process.cwd(), 'static/js/graph-fetch.js'), 'utf-8'))();
  ns = (globalThis as Record<string, any>).__MEMENTO_GRAPH__;
  trimToLocalDepth = ns.trimToLocalDepth;
});

describe('trimToLocalDepth', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const edges = [
    { id: 'ab', source: 'a', target: 'b' },
    { id: 'bc', source: 'b', target: 'c' },
    { id: 'cd', source: 'c', target: 'd' },
  ];

  it('keeps one hop from a on the line a-b-c-d', () => {
    const result = trimToLocalDepth(nodes, edges, 'a', 1);

    expect(result.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(result.edges.map((edge) => edge.id)).toEqual(['ab']);
  });

  it('keeps two hops from a on the line a-b-c-d', () => {
    const result = trimToLocalDepth(nodes, edges, 'a', 2);

    expect(result.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(result.edges.map((edge) => edge.id)).toEqual(['ab', 'bc']);
  });

  it('walks an edge stored in the opposite direction', () => {
    const reversed = [{ id: 'ba', source: 'b', target: 'a' }];
    const result = trimToLocalDepth(nodes, reversed, 'a', 1);

    expect(result.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(result.edges.map((edge) => edge.id)).toEqual(['ba']);
  });

  it('reads object endpoints the same as string ids', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const result = trimToLocalDepth([a, b, { id: 'c' }], [{ id: 'ab', source: a, target: b }], 'a', 1);

    expect(result.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(result.edges).toHaveLength(1);
  });

  it('returns the same arrays when focus is missing', () => {
    expect(trimToLocalDepth(nodes, edges, '', 2)).toEqual({ nodes, edges });
    expect(trimToLocalDepth(nodes, edges, null, 1).nodes).toBe(nodes);
    expect(trimToLocalDepth(nodes, edges, undefined, 1).edges).toBe(edges);
  });

  it('renderVisibleGraph trims only while local mode is on', () => {
    const drawn: string[][] = [];
    ns.dom = {
      orphanToggle: { checked: false },
      orphanBadge: { textContent: '', style: { display: '' } },
    } as typeof ns.dom;
    ns.showEmpty = () => {};
    ns.renderGraph = (visibleNodes) => {
      drawn.push(visibleNodes.map((node) => node.id));
    };
    ns.state.rawGraphNodes = nodes;
    ns.state.rawGraphEdges = edges;
    ns.state.localFocusId = 'a';
    ns.state.localDepth = 1;
    ns.state.localMode = true;

    ns.renderVisibleGraph();
    ns.state.localDepth = 2;
    ns.renderVisibleGraph();
    ns.state.localMode = false;
    ns.renderVisibleGraph();

    expect(drawn).toEqual([
      ['a', 'b'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c', 'd'],
    ]);
  });
});
