import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const cardJs = readFileSync(resolve(root, 'static/js/embedding-health-card.js'), 'utf8');

class FakeElement {
  children: FakeElement[] = [];
  textContent = '';
  className = '';
  value = '';
  type = '';
  title = '';
  disabled = false;
  private hiddenFlag = false;
  private listeners: Record<string, Array<() => void>> = {};
  classList = {
    add: (name: string) => { if (name === 'hidden') this.hiddenFlag = true; },
    remove: (name: string) => { if (name === 'hidden') this.hiddenFlag = false; },
    toggle: (name: string, force: boolean) => { if (name === 'hidden') this.hiddenFlag = force; },
  };
  constructor(readonly tag = 'div') {}
  get firstChild() { return this.children[0] || null; }
  get hidden() { return this.hiddenFlag; }
  appendChild(child: FakeElement) { this.children.push(child); return child; }
  replaceChildren(...nodes: FakeElement[]) { this.children = nodes; }
  setAttribute() {}
  addEventListener(event: string, fn: () => void) { (this.listeners[event] ||= []).push(fn); }
  click() { (this.listeners['click'] || []).forEach((fn) => fn()); }
  fire(event: string) { (this.listeners[event] || []).forEach((fn) => fn()); }
  text(): string { return this.textContent + this.children.map((c) => c.text()).join(' '); }
  find(predicate: (el: FakeElement) => boolean): FakeElement[] {
    return [
      ...(predicate(this) ? [this] : []),
      ...this.children.flatMap((c) => c.find(predicate)),
    ];
  }
}

const HEALTH_IDS = [
  'em-provider', 'em-health-headline', 'em-health-guide', 'em-health-summary', 'em-health-problems',
  'em-problem-list', 'em-health-error', 'em-health-terms', 'ops-status-refresh-btn', 'mf-id-input',
];

function diagnostics(provider: string, counts: Partial<Record<string, number>> = {}) {
  return {
    diagnostics: {
      provider, memoryCount: 100, validEmbeddingCount: 90, coverage: 0.9, diagnosedAt: '2026-11-14T00:00:00.000Z',
      missingEmbeddingCount: 0, unreadableEmbeddingCount: 0, dimensionMismatchCount: 0,
      providerDriftCount: 0, modelDriftCount: 0, ...counts,
    },
  };
}

function createHarness() {
  const pending = new Map<string, (value: unknown) => void>();
  const requested: string[] = [];
  const elements: Record<string, FakeElement> = {};
  HEALTH_IDS.forEach((id) => { elements[id] = new FakeElement(id === 'em-provider' ? 'select' : 'div'); });
  elements['em-provider'].value = 'minilm';
  const activateTab = vi.fn();
  const open = vi.fn();
  const context: any = {
    mementoAdminFetch: (url: string) => new Promise((resolvePromise) => {
      requested.push(url);
      pending.set(url, resolvePromise);
    }),
    document: {
      getElementById: (id: string) => elements[id] ?? null,
      createElement: (tag: string) => new FakeElement(tag),
      createTextNode: (text: string) => Object.assign(new FakeElement('#text'), { textContent: text }),
    },
    __MEMENTO_DASHBOARD_TABS__: { activateTab },
    __MEMENTO_MEMORY_FINDER__: { open },
    console,
  };
  context.window = context;
  vm.runInNewContext(cardJs, context);
  const respond = (url: string, body: unknown, ok = true) => pending.get(url)?.({
    ok, status: ok ? 200 : 500, json: async () => body,
  });
  const settle = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
  return { context, elements, requested, respond, settle, activateTab, open };
}

describe('Dashboard embedding health card on the ops status tab (#1701)', () => {
  it('lives in the status tab next to the zones, with no embedding tab or scatter left', () => {
    const statusTab = dashboardHtml.slice(
      dashboardHtml.indexOf('id="tab-ops-status"'),
      dashboardHtml.indexOf('id="tab-review-candidates"'),
    );
    expect(statusTab.indexOf('id="ops-status-zones"')).toBeGreaterThan(-1);
    expect(statusTab.indexOf('id="em-health-card"')).toBeGreaterThan(statusTab.indexOf('id="ops-status-zones"'));
    for (const id of ['em-provider', 'em-health-headline', 'em-health-guide', 'em-health-summary', 'em-health-problems', 'em-problem-list', 'em-health-terms']) {
      expect(statusTab).toContain(`id="${id}"`);
    }
    expect(dashboardHtml).toContain('/static/js/embedding-health-card.js');
    expect(dashboardHtml).not.toContain('tab-embedding-map');
    expect(dashboardHtml).not.toContain('data-tab="embedding"');
    expect(dashboardHtml).not.toContain('em-scatter');
    expect(dashboardHtml).not.toContain('embedding-map');
  });

  it('shows the no-action guidance when nothing is wrong', async () => {
    const h = createHarness();
    h.context.initEmbeddingHealthCard();
    expect(h.requested).toEqual(['/admin/embedding-health?provider=minilm']);
    h.respond('/admin/embedding-health?provider=minilm', diagnostics('minilm'));
    await h.settle();

    expect(h.elements['em-health-headline'].textContent).toContain('문제 0건');
    expect(h.elements['em-health-headline'].textContent).toContain('90.0%');
    expect(h.elements['em-health-guide'].text()).toContain('조치 불필요');
    expect(h.elements['em-health-guide'].text()).not.toContain('reindex-embeddings');
  });

  it('lists each problem kind with its action and the dry-run command when problems exist', async () => {
    const h = createHarness();
    h.context.initEmbeddingHealthCard();
    h.respond('/admin/embedding-health?provider=minilm', diagnostics('minilm', {
      missingEmbeddingCount: 3, providerDriftCount: 2,
    }));
    await h.settle();

    expect(h.elements['em-health-headline'].textContent).toContain('문제 5건');
    const guide = h.elements['em-health-guide'].text();
    expect(guide).toContain('누락 3건');
    expect(guide).toContain('제공자 드리프트 2건');
    expect(guide).toContain('--prune-foreign-providers');
    expect(guide).not.toContain('모델 드리프트');
    expect(guide).toContain('npm run reindex-embeddings -- --provider minilm --dry-run');
    expect(h.elements['em-health-problems'].children).toHaveLength(5);
  });

  it('defines the coverage term and the five problem kinds', () => {
    const h = createHarness();
    h.context.initEmbeddingHealthCard();
    const terms = h.elements['em-health-terms'].children.map((c) => c.textContent);
    for (const label of ['커버리지', '누락', '읽기 불가/손상', '차원 불일치', '제공자 드리프트', '모델 드리프트']) {
      expect(terms).toContain(label);
    }
  });

  it('ignores a stale response after the provider changes', async () => {
    const h = createHarness();
    h.context.initEmbeddingHealthCard();
    h.elements['em-provider'].value = 'tfidf';
    h.elements['em-provider'].fire('change');
    h.respond('/admin/embedding-health?provider=tfidf', diagnostics('tfidf'));
    await h.settle();
    h.respond('/admin/embedding-health?provider=minilm', diagnostics('minilm', { missingEmbeddingCount: 9 }));
    await h.settle();

    expect(h.elements['em-health-headline'].textContent).toContain('tfidf');
    expect(h.elements['em-health-headline'].textContent).not.toContain('문제 9건');
  });

  it('reloads when the status tab refresh button is pressed', () => {
    const h = createHarness();
    h.context.initEmbeddingHealthCard();
    h.elements['ops-status-refresh-btn'].click();
    expect(h.requested).toHaveLength(2);
  });

  it('shows the server message when the diagnosis request fails', async () => {
    const h = createHarness();
    h.context.initEmbeddingHealthCard();
    h.respond('/admin/embedding-health?provider=minilm', { message: '진단 실패' }, false);
    await h.settle();

    expect(h.elements['em-health-error'].textContent).toBe('진단 실패');
    expect(h.elements['em-health-error'].hidden).toBe(false);
  });

  it('pages the problem list and opens a memory in the memory finder tab', async () => {
    const h = createHarness();
    h.context.initEmbeddingHealthCard();
    h.respond('/admin/embedding-health?provider=minilm', diagnostics('minilm', { missingEmbeddingCount: 60 }));
    await h.settle();

    const missingCard = h.elements['em-health-problems'].children[0];
    missingCard.click();
    const listUrl = '/admin/embedding-health?provider=minilm&problem=missing_embedding&limit=50&offset=0';
    expect(h.requested).toContain(listUrl);
    h.respond(listUrl, {
      problem: 'missing_embedding', total: 60, limit: 50, offset: 0,
      memories: [{ id: 'mem_1', type: 'semantic', ownerId: 'o', projectId: null }],
    });
    await h.settle();

    const list = h.elements['em-problem-list'];
    expect(list.hidden).toBe(false);
    const idButton = list.find((el) => el.tag === 'button' && el.textContent === 'mem_1')[0];
    idButton.click();
    expect(h.activateTab).toHaveBeenCalledWith('memory-finder');
    expect(h.elements['mf-id-input'].value).toBe('mem_1');
    expect(h.open).toHaveBeenCalledWith('mem_1');

    const next = list.find((el) => el.tag === 'button' && el.textContent === '다음')[0];
    next.click();
    expect(h.requested).toContain('/admin/embedding-health?provider=minilm&problem=missing_embedding&limit=50&offset=50');
  });
});
