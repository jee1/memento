import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const WIDTH = 1000;
const HEIGHT = 800;

const appended: Array<{ className: string; y: number }> = [];
const removed: string[] = [];

function selection(onAttr?: (name: string, value: unknown) => void) {
  const self: Record<string, unknown> = {
    attr: (name: string, value: unknown) => {
      onAttr?.(name, value);
      return self;
    },
    text: () => self,
    remove: () => self,
  };
  return self;
}

const svg = {
  attr: (name: string) => String(name === 'width' ? WIDTH : HEIGHT),
  selectAll: (sel: string) => {
    removed.push(sel);
    return { remove: () => undefined };
  },
  append: () => {
    const record = { className: '', y: 0 };
    appended.push(record);
    return selection((name, value) => {
      if (name === 'class') record.className = String(value);
      if (name === 'y') record.y = Number(value);
    });
  },
};

const state = {
  svg: svg as unknown as typeof svg | null,
  mapStatusKey: null as string | null,
  simulation: null,
  zoomBehavior: null,
  nodes: [] as unknown[],
  links: [] as unknown[],
  mapData: null,
  searchResults: null,
  searchResultsExpanded: false,
  highlightedNodeIds: new Set(),
  autoRefreshInterval: null,
  websocket: null,
};

const ns = {
  state,
  escapeHtml: (value: unknown) => String(value),
  debugAnchorMap: () => undefined,
} as unknown as {
  state: typeof state;
  setMapStatusMessage: (kind: string | null, message?: string) => void;
};

beforeAll(() => {
  (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = ns;
  (globalThis as Record<string, unknown>).d3 = {};
  new Function(readFileSync(join(process.cwd(), 'static/js/anchor-map-render.js'), 'utf-8'))();
});

beforeEach(() => {
  appended.length = 0;
  removed.length = 0;
  state.mapStatusKey = null;
  state.svg = svg;
});

describe('issue #904 anchor map error / status messages', () => {
  it('appends only map-error-message after removing all three status classes (I1)', () => {
    ns.setMapStatusMessage('error', '맵 데이터를 불러오지 못했습니다 — boom');

    expect(removed).toEqual([
      '.map-empty-message',
      '.map-error-message',
      '.map-loading-message',
    ]);
    expect(appended).toHaveLength(1);
    expect(appended[0].className).toBe('map-error-message');
  });

  it('replaces empty with error so only one status class remains (I1·I2)', () => {
    ns.setMapStatusMessage('empty', 'agent "default" 에는 앵커가 없습니다 — set_anchor 로 설정하세요');
    appended.length = 0;
    removed.length = 0;

    ns.setMapStatusMessage('error', '맵 데이터를 불러오지 못했습니다 — boom');

    expect(removed).toContain('.map-empty-message');
    expect(appended).toHaveLength(1);
    expect(appended[0].className).toBe('map-error-message');
  });

  it('dedupes identical (kind, message) so append runs once (I5)', () => {
    ns.setMapStatusMessage('error', 'same');
    ns.setMapStatusMessage('error', 'same');

    expect(appended).toHaveLength(1);
  });

  it('re-appends the same error after clear via setMapStatusMessage(null)', () => {
    ns.setMapStatusMessage('error', 'same');
    ns.setMapStatusMessage(null);
    appended.length = 0;

    ns.setMapStatusMessage('error', 'same');

    expect(appended).toHaveLength(1);
    expect(appended[0].className).toBe('map-error-message');
  });

  it('no-ops without throwing when state.svg is null', () => {
    state.svg = null;

    expect(() => ns.setMapStatusMessage('error', 'boom')).not.toThrow();
    expect(appended).toHaveLength(0);
  });

  it('places empty at height/2 and error/loading at y=24', () => {
    ns.setMapStatusMessage('empty', 'empty');
    expect(appended[0].y).toBe(HEIGHT / 2);

    appended.length = 0;
    state.mapStatusKey = null;
    ns.setMapStatusMessage('error', 'err');
    expect(appended[0].y).toBe(24);

    appended.length = 0;
    state.mapStatusKey = null;
    ns.setMapStatusMessage('loading', 'load');
    expect(appended[0].y).toBe(24);
  });

  it('keeps existing graph nodes when an error overlay is shown (I4)', () => {
    state.nodes = [{ id: 'keep-me' }];

    ns.setMapStatusMessage('error', '맵 데이터를 불러오지 못했습니다 — boom');

    expect(state.nodes).toEqual([{ id: 'keep-me' }]);
    expect(appended[0].className).toBe('map-error-message');
  });
});

describe('issue #904 websocket failure paths (executable)', () => {
  type StatusCall = { kind: string | null; message?: string };

  const statusCalls: StatusCall[] = [];
  const elements: Record<string, { checked?: boolean; value?: string }> = {};

  const wsState = {
    autoRefreshInterval: null as ReturnType<typeof setInterval> | null,
    websocket: null as unknown,
    mapData: null as unknown,
  };

  const wsNs = {
    state: wsState,
    debugAnchorMap: () => undefined,
    loadMapData: () => undefined,
    renderMap: () => undefined,
    updateAnchorList: () => undefined,
    getSelectedAgentId: () => 'default',
    setMapStatusMessage: (kind: string | null, message?: string) => {
      statusCalls.push({ kind, message });
    },
  } as {
    state: typeof wsState;
    setMapStatusMessage: (kind: string | null, message?: string) => void;
    fallbackToPolling: () => void;
    handleWsMessage: (event: { data: string }) => void;
    startAutoRefresh: () => void;
    stopAutoRefresh: () => void;
  };

  beforeAll(() => {
    (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = wsNs;
    (globalThis as Record<string, unknown>).document = {
      getElementById: (id: string) => elements[id] ?? null,
    };
    new Function(readFileSync(join(process.cwd(), 'static/js/anchor-map-ws.js'), 'utf-8'))();
  });

  beforeEach(() => {
    statusCalls.length = 0;
    for (const key of Object.keys(elements)) delete elements[key];
    if (wsState.autoRefreshInterval) {
      clearInterval(wsState.autoRefreshInterval);
    }
    wsState.autoRefreshInterval = null;
    wsState.websocket = null;
    wsState.mapData = null;
  });

  afterEach(() => {
    if (wsState.autoRefreshInterval) {
      clearInterval(wsState.autoRefreshInterval);
      wsState.autoRefreshInterval = null;
    }
  });

  it('fallbackToPolling starts auto-refresh when toggle is on and no interval runs (no error)', () => {
    elements['auto-refresh-toggle'] = { checked: true };
    elements['refresh-interval-select'] = { value: '30000' };

    wsNs.fallbackToPolling();

    expect(wsState.autoRefreshInterval).not.toBeNull();
    expect(statusCalls.filter((call) => call.kind === 'error')).toHaveLength(0);
  });

  it('fallbackToPolling is a no-op when polling is already active (no error)', () => {
    wsState.autoRefreshInterval = setInterval(() => undefined, 60_000);
    const existing = wsState.autoRefreshInterval;
    elements['auto-refresh-toggle'] = { checked: false };

    wsNs.fallbackToPolling();

    expect(wsState.autoRefreshInterval).toBe(existing);
    expect(statusCalls).toHaveLength(0);
  });

  it('fallbackToPolling shows in-map error when neither websocket polling nor toggle is active', () => {
    elements['auto-refresh-toggle'] = { checked: false };

    wsNs.fallbackToPolling();

    expect(statusCalls).toEqual([
      {
        kind: 'error',
        message: '실시간 갱신이 끊겼습니다 — Refresh 로 다시 불러오세요',
      },
    ]);
  });

  it('handleWsMessage shows in-map error when the payload fails to parse', () => {
    wsNs.handleWsMessage({ data: '{not-json' });

    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0].kind).toBe('error');
    expect(statusCalls[0].message).toMatch(/^실시간 맵 갱신을 처리하지 못했습니다 — /);
  });
});

describe('issue #904 loadMapData failure while auto-refresh is active (AC3)', () => {
  type StatusCall = { kind: string | null; message?: string };

  const statusCalls: StatusCall[] = [];
  const dataState = {
    mapData: {
      agent_id: 'default',
      anchors: [],
      nodes: [{ id: 'keep-node' }],
      links: [],
      timestamp: '2026-09-10T00:00:00.000Z',
    } as Record<string, unknown> | null,
    nodes: [{ id: 'keep-node' }] as Array<{ id: string }>,
    autoRefreshInterval: 42 as unknown as ReturnType<typeof setInterval>,
  };

  const dataNs = {
    state: dataState,
    debugAnchorMap: () => undefined,
    normalizeMapData: (payload: unknown) => payload,
    renderMap: vi.fn(),
    updateAnchorList: vi.fn(),
    setMapStatusMessage: (kind: string | null, message?: string) => {
      statusCalls.push({ kind, message });
    },
  } as {
    state: typeof dataState;
    setMapStatusMessage: (kind: string | null, message?: string) => void;
    loadMapData: (options?: unknown) => Promise<void>;
    renderMap: ReturnType<typeof vi.fn>;
    updateAnchorList: ReturnType<typeof vi.fn>;
  };

  beforeAll(() => {
    (globalThis as Record<string, unknown>).__MEMENTO_ANCHOR_MAP__ = dataNs;
    (globalThis as Record<string, unknown>).document = {
      getElementById: () => ({ value: 'default', options: [] }),
    };
    new Function(readFileSync(join(process.cwd(), 'static/js/anchor-map-data.js'), 'utf-8'))();
  });

  beforeEach(() => {
    statusCalls.length = 0;
    dataState.mapData = {
      agent_id: 'default',
      anchors: [],
      nodes: [{ id: 'keep-node' }],
      links: [],
      timestamp: '2026-09-10T00:00:00.000Z',
    };
    dataState.nodes = [{ id: 'keep-node' }];
    dataState.autoRefreshInterval = 42 as unknown as ReturnType<typeof setInterval>;
    dataNs.renderMap.mockClear();
    dataNs.updateAnchorList.mockClear();
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    (globalThis as Record<string, unknown>).mementoAdminFetch = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders map-error via setMapStatusMessage without alert when the periodic refresh fetch fails', async () => {
    await dataNs.loadMapData();

    expect(statusCalls.some((call) =>
      call.kind === 'error' &&
      typeof call.message === 'string' &&
      call.message.includes('맵 데이터를 불러오지 못했습니다') &&
      call.message.includes('network down'),
    )).toBe(true);
    expect(globalThis.alert).not.toHaveBeenCalled();
    // I4 — failure overlay must not wipe already-rendered nodes / last good mapData
    expect(dataState.nodes).toEqual([{ id: 'keep-node' }]);
    expect(dataState.mapData?.nodes).toEqual([{ id: 'keep-node' }]);
    expect(dataNs.renderMap).not.toHaveBeenCalled();
  });
});
