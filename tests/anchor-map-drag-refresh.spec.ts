import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type DragHandlers = Record<string, (event: unknown, d: Record<string, unknown>) => void>;

const handlers: DragHandlers = {};
let removeCount = 0;
let normalizeCalls = 0;

const gSelection = {
  node: () => ({}),
  selectAll: () => ({
    remove: () => {
      removeCount += 1;
    },
  }),
};

const svg = {
  attr: (name: string) => (name === 'width' || name === 'height' ? '800' : ''),
  select: () => gSelection,
  selectAll: () => ({
    remove: () => {
      removeCount += 1;
    },
    classed: () => undefined,
    text: () => undefined,
  }),
  append: () => ({
    attr: function attr() {
      return this;
    },
    text: function text() {
      return this;
    },
  }),
};

const simulation = {
  alphaTarget: () => ({ restart: () => undefined }),
  nodes: () => undefined,
  force: () => ({ distance: () => undefined }),
  on: () => undefined,
  alpha: () => ({ restart: () => undefined }),
  stop: () => undefined,
};

const state = {
  svg: svg as unknown,
  simulation: simulation as unknown,
  zoomBehavior: null,
  nodes: [] as Array<Record<string, unknown>>,
  links: [] as unknown[],
  mapData: null as unknown,
  searchResults: null,
  searchResultsExpanded: false,
  highlightedNodeIds: new Set(),
  autoRefreshInterval: null,
  websocket: null,
  mapStatusKey: null as string | null,
  layoutMode: 'auto',
  layoutPersistDisabled: false,
  redrawTick: null,
  activeDragCount: 0,
  pendingRefreshRender: false,
};

const callOrder: string[] = [];

const ns = {
  state,
  escapeHtml: (value: unknown) => String(value),
  debugAnchorMap: () => undefined,
  normalizeMapData: (data: unknown) => {
    normalizeCalls += 1;
    return data;
  },
  getSelectedAgentId: () => 'default',
  getAnchorMapPalette: () => ({
    slotColors: { A: { fill: '#a', stroke: '#as' }, B: { fill: '#b', stroke: '#bs' }, C: { fill: '#c', stroke: '#cs' } },
    memoryFill: '#m',
    memoryStroke: '#ms',
    labelFill: '#l',
  }),
  readAgentLayout: () => ({}),
  mergeNodeLayout: (nodes: unknown[]) => ({ nodes, removedIds: [] }),
  pruneStoredNodes: () => undefined,
  writeAgentLayout: () => {
    callOrder.push('persist');
    return { ok: true };
  },
  layoutNodesByHop: () => undefined,
} as Record<string, unknown> & {
  state: typeof state;
  renderMap: () => void;
  flushDeferredRender: () => void;
  releaseDragDeferral: () => void;
  makeDragBehavior: (sim: unknown) => unknown;
};

let realRenderMap: () => void;

function resetState() {
  removeCount = 0;
  normalizeCalls = 0;
  callOrder.length = 0;
  state.activeDragCount = 0;
  state.pendingRefreshRender = false;
  state.mapStatusKey = null;
  state.layoutPersistDisabled = false;
  state.layoutMode = 'auto';
  state.nodes = [];
  state.links = [];
  state.mapData = { agent_id: 'default', nodes: [], links: [], timestamp: 't' };
  state.svg = svg;
  state.simulation = simulation;
  for (const key of Object.keys(handlers)) delete handlers[key];
  if (realRenderMap) ns.renderMap = realRenderMap;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = ns;
  (globalThis as Record<string, unknown>).d3 = {
    drag: () => {
      const behavior = {
        on: (name: string, fn: (event: unknown, d: Record<string, unknown>) => void) => {
          handlers[name] = fn;
          return behavior;
        },
      };
      return behavior;
    },
  };
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  new Function(readFileSync(join(process.cwd(), 'static/js/anchor-map-render.js'), 'utf-8'))();
  realRenderMap = ns.renderMap;
});

beforeEach(() => {
  resetState();
});

function installDragHandlers() {
  for (const key of Object.keys(handlers)) delete handlers[key];
  ns.makeDragBehavior(simulation);
  expect(handlers.start).toBeTypeOf('function');
  expect(handlers.end).toBeTypeOf('function');
}

describe('issue #948 defer refresh render during drag', () => {
  it('T1 (R1) renderMap during drag sets pending and skips DOM wipe', () => {
    state.activeDragCount = 1;
    ns.renderMap();
    expect(state.pendingRefreshRender).toBe(true);
    expect(removeCount).toBe(0);
    expect(normalizeCalls).toBe(0);
  });

  it('T2 (R2) one deferred refresh flushes exactly once on end', () => {
    installDragHandlers();
    const node = { id: 'mem-a', type: 'memory', x: 10, y: 10, content: 'a' };
    handlers.start!({ active: 0 }, node);
    expect(state.activeDragCount).toBe(1);

    ns.renderMap();
    expect(state.pendingRefreshRender).toBe(true);

    const flushSpy = vi.fn();
    ns.renderMap = flushSpy;

    handlers.end!({ active: 0 }, node);
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(state.pendingRefreshRender).toBe(false);
    expect(state.activeDragCount).toBe(0);
  });

  it('T3 (R3) three deferred refreshes coalesce to one flush', () => {
    installDragHandlers();
    const node = { id: 'mem-a', type: 'memory', x: 10, y: 10, content: 'a' };
    handlers.start!({ active: 0 }, node);
    ns.renderMap();
    ns.renderMap();
    ns.renderMap();
    expect(state.pendingRefreshRender).toBe(true);

    const flushSpy = vi.fn();
    ns.renderMap = flushSpy;
    handlers.end!({ active: 0 }, node);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('T4 (R2) end with zero deferred refreshes does not flush', () => {
    installDragHandlers();
    const node = { id: 'mem-a', type: 'memory', x: 10, y: 10, content: 'a' };
    handlers.start!({ active: 0 }, node);

    const flushSpy = vi.fn();
    ns.renderMap = flushSpy;
    handlers.end!({ active: 0 }, node);
    expect(flushSpy).toHaveBeenCalledTimes(0);
    expect(state.pendingRefreshRender).toBe(false);
    expect(state.activeDragCount).toBe(0);
  });

  it('T5 (R4) renderMap with no active drag follows normal path', () => {
    state.activeDragCount = 0;
    state.pendingRefreshRender = false;
    ns.renderMap();
    expect(normalizeCalls).toBe(1);
    expect(state.pendingRefreshRender).toBe(false);
  });

  it('T6 multitouch: first end keeps deferral, second end flushes once', () => {
    installDragHandlers();
    const a = { id: 'a', type: 'memory', x: 1, y: 1, content: 'a' };
    const b = { id: 'b', type: 'memory', x: 2, y: 2, content: 'b' };
    handlers.start!({ active: 0 }, a);
    handlers.start!({ active: 1 }, b);
    expect(state.activeDragCount).toBe(2);

    ns.renderMap();
    const flushSpy = vi.fn();
    ns.renderMap = flushSpy;

    handlers.end!({ active: 1 }, a);
    expect(state.activeDragCount).toBe(1);
    expect(flushSpy).toHaveBeenCalledTimes(0);
    expect(state.pendingRefreshRender).toBe(true);

    handlers.end!({ active: 0 }, b);
    expect(state.activeDragCount).toBe(0);
    expect(flushSpy).toHaveBeenCalledTimes(1);
  });

  it('T7 (R5) releaseDragDeferral clears count and flushes pending', () => {
    state.activeDragCount = 1;
    state.pendingRefreshRender = true;
    const flushSpy = vi.fn();
    ns.renderMap = flushSpy;

    ns.releaseDragDeferral();
    expect(state.activeDragCount).toBe(0);
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(state.pendingRefreshRender).toBe(false);
  });

  it('T8 (R5) releaseDragDeferral is no-op when no drag is active', () => {
    state.activeDragCount = 0;
    state.pendingRefreshRender = true;
    const flushSpy = vi.fn();
    ns.renderMap = flushSpy;

    ns.releaseDragDeferral();
    expect(flushSpy).toHaveBeenCalledTimes(0);
    expect(state.pendingRefreshRender).toBe(true);
  });

  it('T9 persistPinnedLayout runs before flush renderMap on end', () => {
    installDragHandlers();
    const node = {
      id: 'mem-a',
      type: 'memory',
      x: 10,
      y: 10,
      fx: 40,
      fy: 40,
      content: 'a',
      pinned: false,
    };
    state.nodes = [node];
    state.mapData = { agent_id: 'default', nodes: [node], links: [] };

    handlers.start!({ active: 0 }, node);
    // Simulate meaningful drag distance (>= 3px) via fx/fy vs start.
    node.fx = 40;
    node.fy = 40;

    ns.renderMap();
    expect(state.pendingRefreshRender).toBe(true);

    ns.renderMap = () => {
      callOrder.push('render');
    };

    handlers.end!({ active: 0 }, node);
    expect(callOrder).toEqual(['persist', 'render']);
    expect(node.pinned).toBe(true);
  });
});
