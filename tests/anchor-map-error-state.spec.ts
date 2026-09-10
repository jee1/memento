import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
});
