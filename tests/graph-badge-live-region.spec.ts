import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

type BadgeEl = {
  textContent: string;
  style: { display: string };
  __badgePendingText?: string;
  __badgeCommitted?: boolean;
};

type GraphNs = {
  setBadgeText: (el: BadgeEl | null, text: string) => void;
  nextFrame: (callback: () => void) => void;
  applySearchHighlight: () => void;
  renderVisibleGraph: () => void;
  showEmpty?: (v: boolean) => void;
  renderGraph?: (nodes: unknown[], edges: unknown[]) => void;
  dom: Record<string, unknown>;
  state: {
    lastGraphNodes: unknown;
    lastGraphEdges: unknown;
    rawGraphNodes: unknown;
    rawGraphEdges: unknown;
    activeSearchQuery: string;
    renderedNodeSelection: unknown;
    renderedLinkSelection: unknown;
    simulation: unknown;
  };
};

function makeBadge(): BadgeEl {
  return { textContent: '', style: { display: '' } };
}

function loadScript(relativePath: string): void {
  new Function(readFileSync(join(process.cwd(), relativePath), 'utf-8'))();
}

const frames: Array<() => void> = [];
let ns: GraphNs;
const previousRaf = (globalThis as Record<string, unknown>).requestAnimationFrame;
const previousD3 = (globalThis as Record<string, unknown>).d3;

function flush(): void {
  const pending = frames.splice(0, frames.length);
  for (const cb of pending) {
    cb();
  }
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) => {
    frames.push(() => {
      cb(0);
    });
    return frames.length;
  };
  (globalThis as Record<string, unknown>).d3 = {
    select: () => ({
      selectAll: () => ({
        remove() {},
      }),
    }),
  };

  loadScript('static/js/graph-shared.js');
  loadScript('static/js/graph-search.js');
  loadScript('static/js/graph-fetch.js');
  ns = (globalThis as Record<string, unknown>).__MEMENTO_GRAPH__ as GraphNs;
});

afterAll(() => {
  if (previousRaf === undefined) {
    delete (globalThis as Record<string, unknown>).requestAnimationFrame;
  } else {
    (globalThis as Record<string, unknown>).requestAnimationFrame = previousRaf;
  }
  if (previousD3 === undefined) {
    delete (globalThis as Record<string, unknown>).d3;
  } else {
    (globalThis as Record<string, unknown>).d3 = previousD3;
  }
});

beforeEach(() => {
  frames.length = 0;
  ns.state.activeSearchQuery = '';
  ns.state.lastGraphNodes = null;
  ns.state.lastGraphEdges = null;
  ns.state.rawGraphNodes = null;
  ns.state.rawGraphEdges = null;
  ns.state.renderedNodeSelection = null;
  ns.state.renderedLinkSelection = null;
  ns.state.simulation = null;
});

afterEach(() => {
  frames.length = 0;
});

describe('issue #950 setBadgeText live-region timing', () => {
  it('T1: hidden→visible defers textContent until next frame', () => {
    const el = makeBadge();
    ns.setBadgeText(el, '3개 노드 매칭');

    expect(el.style.display).toBe('inline-block');
    expect(el.textContent).toBe('');
    flush();
    expect(el.textContent).toBe('3개 노드 매칭');
  });

  it('T2: already-visible badge updates text synchronously', () => {
    const el = makeBadge();
    el.style.display = 'inline-block';
    el.textContent = '3개 노드 매칭';
    el.__badgeCommitted = true;
    frames.length = 0;

    ns.setBadgeText(el, '7개 노드 매칭');

    expect(el.textContent).toBe('7개 노드 매칭');
    expect(frames).toHaveLength(0);
  });

  it('T3: empty text hides badge synchronously', () => {
    const el = makeBadge();
    el.style.display = 'inline-block';
    el.textContent = 'x';

    ns.setBadgeText(el, '');

    expect(el.textContent).toBe('');
    expect(el.style.display).toBe('none');
  });

  it('T4: stale write cancelled when hidden before flush', () => {
    const el = makeBadge();
    ns.setBadgeText(el, 'A');
    ns.setBadgeText(el, '');
    flush();

    expect(el.textContent).toBe('');
    expect(el.style.display).toBe('none');
  });

  it('T5: consecutive show writes keep only last pending text', () => {
    const el = makeBadge();
    ns.setBadgeText(el, 'A');
    ns.setBadgeText(el, 'B');
    flush();

    expect(el.textContent).toBe('B');
  });

  it('T6: null element is a no-op', () => {
    expect(() => ns.setBadgeText(null, 'x')).not.toThrow();
  });

  it('T10: same-tick re-show does not sync-write textContent before flush', () => {
    const el = makeBadge();
    ns.setBadgeText(el, 'A');
    ns.setBadgeText(el, 'B');

    expect(el.textContent).toBe('');
    flush();
    expect(el.textContent).toBe('B');
  });

  it('T11: after commit, setBadgeText updates synchronously (R2)', () => {
    const el = makeBadge();
    ns.setBadgeText(el, 'A');
    flush();
    expect(el.__badgeCommitted).toBe(true);
    frames.length = 0;

    ns.setBadgeText(el, 'C');

    expect(el.textContent).toBe('C');
    expect(frames).toHaveLength(0);
  });

  it('T12: hide clears commit flag so next show defers again', () => {
    const el = makeBadge();
    ns.setBadgeText(el, 'A');
    flush();
    expect(el.__badgeCommitted).toBe(true);

    ns.setBadgeText(el, '');
    expect(el.__badgeCommitted).toBe(false);

    ns.setBadgeText(el, 'D');
    expect(el.textContent).toBe('');
    flush();
    expect(el.textContent).toBe('D');
  });
});

describe('issue #950 badge call sites via helpers', () => {
  it('T7: search match badge goes through setBadgeText', () => {
    const matchBadge = makeBadge();
    ns.dom = { matchBadge };
    ns.state.lastGraphNodes = [{ id: 'a', content: 'foo' }];
    ns.state.activeSearchQuery = 'foo';

    ns.applySearchHighlight();
    expect(matchBadge.style.display).toBe('inline-block');
    flush();
    expect(matchBadge.textContent).toBe('1개 노드 매칭');

    ns.state.activeSearchQuery = '';
    ns.applySearchHighlight();
    expect(matchBadge.style.display).toBe('none');
    expect(matchBadge.textContent).toBe('');
  });

  it('T8: orphan badge goes through setBadgeText', () => {
    const orphanBadge = makeBadge();
    const orphanToggle = { checked: true };
    ns.dom = { orphanBadge, orphanToggle, svgEl: {} };
    ns.showEmpty = () => {};
    ns.renderGraph = () => {};
    ns.state.rawGraphNodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    ns.state.rawGraphEdges = [{ id: 'e1', source: 'a', target: 'b' }];

    ns.renderVisibleGraph();
    expect(orphanBadge.style.display).toBe('inline-block');
    flush();
    expect(orphanBadge.textContent).toBe('1개 숨김');

    orphanToggle.checked = false;
    ns.renderVisibleGraph();
    expect(orphanBadge.style.display).toBe('none');
    expect(orphanBadge.textContent).toBe('');
  });

  it('T9: zero matches still show 0개 노드 매칭', () => {
    const matchBadge = makeBadge();
    ns.dom = { matchBadge };
    ns.state.lastGraphNodes = [{ id: 'a', content: 'foo' }];
    ns.state.activeSearchQuery = 'zzz';

    ns.applySearchHighlight();
    expect(matchBadge.style.display).toBe('inline-block');
    flush();
    expect(matchBadge.textContent).toBe('0개 노드 매칭');
  });
});
