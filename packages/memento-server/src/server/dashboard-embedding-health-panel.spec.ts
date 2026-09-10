import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const fetchJs = readFileSync(resolve(root, 'static/js/embedding-map-fetch.js'), 'utf8');
const panelJs = readFileSync(resolve(root, 'static/js/embedding-map-panel.js'), 'utf8');
const scatterJs = readFileSync(resolve(root, 'static/js/embedding-map-chart-scatter.js'), 'utf8');

describe('Dashboard embedding health panel (#896)', () => {
  it('puts diagnostics before the auxiliary map and demotes k/limit to Advanced', () => {
    expect(dashboardHtml).toContain('Embedding Health');
    expect(dashboardHtml).toContain('id="em-health-summary"');
    expect(dashboardHtml).toContain('id="em-health-problems"');
    expect(dashboardHtml).toContain('<summary>Advanced</summary>');
    expect(dashboardHtml.indexOf('id="em-health-summary"')).toBeLessThan(
      dashboardHtml.indexOf('id="em-scatter"'),
    );
    expect(dashboardHtml).toContain('품질 점수나 시간 비교 기준이 아닙니다');
  });

  it('loads health independently and removes meaningless plot axes', () => {
    expect(fetchJs).toContain('/admin/embedding-health');
    expect(scatterJs).not.toContain('axisBottom');
    expect(scatterJs).not.toContain('axisLeft');
    expect(scatterJs).toContain(".attr('tabindex', 0)");
    expect(scatterJs).toContain(".attr('role', 'button')");
    expect(scatterJs).toContain(".on('keydown'");
  });

  it('ignores stale responses after the provider changes', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const renderedHealth: string[] = [];
    const renderedMaps: string[] = [];
    const state: any = {
      lastMeta: {}, currentPoints: [], lastHealth: null, requestGeneration: 0, problemRequestGeneration: 0,
      setEmbeddingMapLoading: vi.fn(), setEmbeddingMapError: vi.fn(),
      updateEmbeddingMapCacheInfo: vi.fn(), renderEmbeddingMapMeta: vi.fn(),
      renderEmbeddingHealthError: vi.fn(), renderEmbeddingProblemList: vi.fn(),
      renderEmbeddingHealth: vi.fn((health: { provider: string }) => renderedHealth.push(health.provider)),
      renderScatter: vi.fn((body: { meta: { provider: string } }) => renderedMaps.push(body.meta.provider)),
    };
    const context: any = {
      __MEMENTO_EMBEDDING_MAP__: state,
      mementoAdminFetch: (url: string) => new Promise((resolvePromise) => pending.set(url, resolvePromise)),
      document: { getElementById: () => null },
      console,
    };
    context.window = context;
    vm.runInNewContext(fetchJs, context);

    state.loadEmbeddingMap({ provider: 'minilm', limit: 300, k: 6 });
    state.loadEmbeddingMap({ provider: 'tfidf', limit: 300, k: 6 });
    const respond = (url: string, body: unknown) => pending.get(url)?.({ ok: true, status: 200, json: async () => body });
    respond('/admin/embedding-health?provider=tfidf', { diagnostics: { provider: 'tfidf' } });
    respond('/admin/embedding-map?provider=tfidf&limit=300&k=6', { points: [], meta: { provider: 'tfidf' } });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    respond('/admin/embedding-health?provider=minilm', { diagnostics: { provider: 'minilm' } });
    respond('/admin/embedding-map?provider=minilm&limit=300&k=6', { points: [], meta: { provider: 'minilm' } });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    expect(renderedHealth).toEqual(['tfidf']);
    expect(renderedMaps).toEqual(['tfidf']);
  });

  it('does not reuse map metadata from the previous provider when the next map fails', async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const renderedMeta: string[] = [];
    const state: any = {
      lastMeta: null, currentPoints: [], lastHealth: null, requestGeneration: 0, problemRequestGeneration: 0,
      setEmbeddingMapLoading: vi.fn(), setEmbeddingMapError: vi.fn(),
      updateEmbeddingMapCacheInfo: vi.fn(), renderEmbeddingHealthError: vi.fn(),
      renderEmbeddingProblemList: vi.fn(), renderEmbeddingHealth: vi.fn(), renderScatter: vi.fn(),
      renderEmbeddingMapMeta: vi.fn((body: { meta?: { provider?: string } }) => {
        if (body.meta?.provider) renderedMeta.push(body.meta.provider);
      }),
    };
    const context: any = {
      __MEMENTO_EMBEDDING_MAP__: state,
      mementoAdminFetch: (url: string) => new Promise((resolvePromise) => pending.set(url, resolvePromise)),
      document: { getElementById: () => null },
      console,
    };
    context.window = context;
    vm.runInNewContext(fetchJs, context);
    const respond = (url: string, body: unknown, ok = true) => pending.get(url)?.({
      ok, status: ok ? 200 : 500, json: async () => body,
    });

    state.loadEmbeddingMap({ provider: 'minilm', limit: 300, k: 6 });
    respond('/admin/embedding-health?provider=minilm', { diagnostics: { provider: 'minilm' } });
    respond('/admin/embedding-map?provider=minilm&limit=300&k=6', {
      points: [], meta: { provider: 'minilm' },
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    renderedMeta.length = 0;

    state.loadEmbeddingMap({ provider: 'tfidf', limit: 300, k: 6 });
    expect(state.lastMeta).toBeNull();
    respond('/admin/embedding-health?provider=tfidf', { diagnostics: { provider: 'tfidf' } });
    respond('/admin/embedding-map?provider=tfidf&limit=300&k=6', { error: 'map failed' }, false);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    expect(renderedMeta).toEqual([]);
  });

  it('ignores stale memory details after refreshes and rapid selections', async () => {
    class FakeElement {
      children: FakeElement[] = [];
      textContent = '';
      className = '';
      classList = { add: vi.fn(), remove: vi.fn() };
      get firstChild() { return this.children[0] || null; }
      appendChild(child: FakeElement) { this.children.push(child); return child; }
      removeChild(child: FakeElement) { this.children = this.children.filter((item) => item !== child); }
      setAttribute() {}
      addEventListener() {}
    }
    const pending = new Map<string, (value: unknown) => void>();
    const panel = new FakeElement();
    const state: any = {
      lastMeta: null, currentPoints: [], lastHealth: null, requestGeneration: 0,
      problemRequestGeneration: 0, detailRequestGeneration: 0,
      setEmbeddingMapLoading: vi.fn(), setEmbeddingMapError: vi.fn(),
      updateEmbeddingMapCacheInfo: vi.fn(), renderEmbeddingMapMeta: vi.fn(), renderScatter: vi.fn(),
      renderEmbeddingHealthError: vi.fn(), renderEmbeddingProblemList: vi.fn(), renderEmbeddingHealth: vi.fn(),
    };
    const context: any = {
      __MEMENTO_EMBEDDING_MAP__: state,
      mementoAdminFetch: (url: string) => new Promise((resolvePromise) => pending.set(url, resolvePromise)),
      document: {
        getElementById: (id: string) => id === 'em-side-panel' ? panel : null,
        createElement: () => new FakeElement(),
        createTextNode: (text: string) => Object.assign(new FakeElement(), { textContent: text }),
      },
      navigator: {},
      console,
    };
    context.window = context;
    vm.runInNewContext(panelJs, context);
    vm.runInNewContext(fetchJs, context);
    const respondDetail = (id: string) => pending.get('/admin/memory/items/' + id)?.({
      ok: true,
      json: async () => ({
        memory: { id, type: 'semantic', importance: 0.5, created_at: '2026-09-10', tags: '[]', content: id },
      }),
    });
    const panelText = () => {
      const visit = (element: FakeElement): string => element.textContent + element.children.map(visit).join('');
      return visit(panel);
    };

    state.openMemoryById('old-provider');
    state.loadEmbeddingMap({ provider: 'tfidf', limit: 300, k: 6 });
    respondDetail('old-provider');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(panel.children).toHaveLength(0);

    state.openMemoryById('first');
    state.openMemoryById('second');
    respondDetail('second');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    respondDetail('first');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

    expect(panelText()).toContain('second');
    expect(panelText()).not.toContain('first');

    state.openMemoryById('pending-before-dot');
    state.openSidePanel({
      id: 'scatter-dot', type: 'semantic', importance: 0.5,
      created_at: '2026-09-10', tags: [], content: 'scatter-dot',
    });
    respondDetail('pending-before-dot');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(panelText()).toContain('scatter-dot');
    expect(panelText()).not.toContain('pending-before-dot');

    state.openMemoryById('pending-before-close');
    state.closeSidePanel();
    respondDetail('pending-before-close');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(panelText()).not.toContain('pending-before-close');
  });
});
