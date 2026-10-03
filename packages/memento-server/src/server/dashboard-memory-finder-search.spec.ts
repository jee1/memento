/**
 * Dashboard memory finder search mode (#1118 Phase 2).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const memoryFinderPanelJs = readFileSync(resolve(root, 'static/js/memory-finder-panel.js'), 'utf8');
const memoryFinderSearchJs = readFileSync(resolve(root, 'static/js/memory-finder-search.js'), 'utf8');

function createClassList() {
  const classes = new Set<string>();
  return {
    add: (n: string) => classes.add(n),
    remove: (n: string) => classes.delete(n),
    toggle: (n: string, force?: boolean) => {
      if (force === true) classes.add(n);
      else if (force === false) classes.delete(n);
      else if (classes.has(n)) classes.delete(n);
      else classes.add(n);
    },
    contains: (n: string) => classes.has(n),
  };
}

const MF_PANEL_ELEMENT_IDS = [
  'mf-id-input',
  'mf-status',
  'mf-empty',
  'mf-d-id',
  'mf-d-type',
  'mf-d-importance',
  'mf-d-privacy',
  'mf-d-pinned',
  'mf-d-created',
  'mf-d-accessed',
  'mf-d-tags',
  'mf-d-source',
  'mf-d-project',
  'mf-d-owner',
  'mf-d-content',
] as const;

type DomNode = {
  tagName: string;
  type: string;
  className: string;
  id?: string;
  _textContent: string;
  _value: string;
  _checked: boolean;
  _radioValue?: string;
  _attrs: Record<string, string>;
  children: DomNode[];
  classList: ReturnType<typeof createClassList>;
  appendChild: (child: DomNode) => DomNode;
  firstChild: DomNode | null;
  textContent: string;
  value: string;
  checked: boolean;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  addEventListener: (type: string, fn: (...args: unknown[]) => void) => void;
  _fireEvent: (type: string, event?: unknown) => void;
};

async function flushPromises() {
  await new Promise((r) => setTimeout(r, 0));
}

function createMemoryFinderSearchHarness() {
  const elements: Record<string, DomNode> = {};
  const searchSubmitHandlers: Array<(event: { preventDefault: () => void }) => void> = [];
  const changeHandlers: Record<string, Array<() => void>> = {
    'mf-mode-id': [],
    'mf-mode-search': [],
  };

  function createDomNode(
    tag: string,
    init: { id?: string; hidden?: boolean; checked?: boolean; value?: string; radioValue?: string } = {},
  ): DomNode {
    const classList = createClassList();
    if (init.hidden) {
      classList.add('hidden');
    }

    const children: DomNode[] = [];
    const eventHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const attrs: Record<string, string> = {};

    const node: DomNode = {
      tagName: tag.toUpperCase(),
      type: '',
      className: '',
      _textContent: '',
      _value: init.value ?? '',
      _checked: init.checked ?? false,
      _radioValue: init.radioValue,
      _attrs: attrs,
      children,
      classList,
      appendChild(child: DomNode) {
        children.push(child);
        return child;
      },
      get firstChild() {
        return children[0] ?? null;
      },
      get textContent() {
        return node._textContent;
      },
      set textContent(value: string) {
        node._textContent = value;
        if (value === '') {
          children.length = 0;
        }
      },
      get value() {
        if (init.radioValue !== undefined) {
          return init.radioValue;
        }
        return node._value;
      },
      set value(v: string) {
        node._value = v;
      },
      get checked() {
        return node._checked;
      },
      set checked(v: boolean) {
        node._checked = v;
      },
      setAttribute(name: string, value: string) {
        attrs[name] = value;
      },
      getAttribute(name: string) {
        return attrs[name] ?? null;
      },
      addEventListener(type: string, fn: (...args: unknown[]) => void) {
        if (!eventHandlers[type]) {
          eventHandlers[type] = [];
        }
        eventHandlers[type].push(fn);
        if (type === 'submit' && init.id === 'mf-search-form') {
          searchSubmitHandlers.push(fn as (event: { preventDefault: () => void }) => void);
        }
        if (type === 'change' && init.id && changeHandlers[init.id]) {
          changeHandlers[init.id].push(fn as () => void);
        }
      },
      _fireEvent(type: string, event?: unknown) {
        for (const fn of eventHandlers[type] ?? []) {
          fn(event);
        }
      },
    };

    if (init.id) {
      node.id = init.id;
      elements[init.id] = node;
    }

    return node;
  }

  for (const id of MF_PANEL_ELEMENT_IDS) {
    createDomNode('div', { id });
  }
  createDomNode('div', { id: 'mf-detail', hidden: true });
  createDomNode('form', { id: 'mf-id-form' });
  createDomNode('form', { id: 'mf-search-form', hidden: true });
  createDomNode('ul', { id: 'mf-results', hidden: true });
  createDomNode('input', { id: 'mf-mode-id', checked: true, radioValue: 'id' });
  createDomNode('input', { id: 'mf-mode-search', checked: false, radioValue: 'search' });
  createDomNode('input', { id: 'mf-search-input' });
  createDomNode('select', { id: 'mf-search-type', value: '' });
  createDomNode('select', { id: 'mf-search-limit', value: '25' });

  const mementoAdminFetch = vi.fn();
  const sandbox: Record<string, unknown> = {
    console,
    URLSearchParams,
    Error,
    location: { search: '' },
    document: {
      getElementById: (id: string) => elements[id] ?? null,
      createElement: (tag: string) => createDomNode(tag),
    },
    mementoAdminFetch,
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(memoryFinderPanelJs, sandbox);
  vm.runInContext(memoryFinderSearchJs, sandbox);

  const ns = sandbox.__MEMENTO_MEMORY_FINDER__ as {
    open: (memoryId: string) => Promise<void>;
    search: (q: string, type?: string, limit?: string) => Promise<void>;
    searchUrl: (q: string, type: string, limit: string) => string;
  };
  const initMemoryFinderPanel = sandbox.initMemoryFinderPanel as () => void;

  return {
    elements,
    ns,
    initMemoryFinderPanel,
    mementoAdminFetch,
    searchSubmitHandlers,
    changeHandlers,
    sandbox,
  };
}

describe('dashboard memory finder search (#1118 Phase 2)', () => {
  it('wires search markup and script order in dashboard.html', () => {
    expect(dashboardHtml).toContain('id="mf-search-form"');
    expect(dashboardHtml).toContain('id="mf-mode-search"');
    expect(dashboardHtml).toContain('id="mf-results"');

    const panelIdx = dashboardHtml.indexOf('<script src="/static/js/memory-finder-panel.js"></script>');
    const searchIdx = dashboardHtml.indexOf('<script src="/static/js/memory-finder-search.js"></script>');
    expect(panelIdx).toBeGreaterThanOrEqual(0);
    expect(searchIdx).toBeGreaterThan(panelIdx);
  });

  it('searchUrl builds query strings', () => {
    const harness = createMemoryFinderSearchHarness();
    expect(harness.ns.searchUrl('hello', '', '25')).toBe('/admin/memory/search?q=hello&limit=25');
    expect(harness.ns.searchUrl('hello', 'semantic', '50')).toBe(
      '/admin/memory/search?q=hello&type=semantic&limit=50',
    );
    expect(harness.ns.searchUrl('a b', '', '25')).toBe('/admin/memory/search?q=a+b&limit=25');
  });

  it('search renders result list on 200 response', async () => {
    const harness = createMemoryFinderSearchHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: 'mem_1',
            type: 'semantic',
            content_preview: 'first preview',
            similarity: 0.8123,
            created_at: 'x',
          },
          {
            id: 'mem_2',
            type: 'episodic',
            content_preview: 'second',
            similarity: 0.5,
            created_at: 'y',
          },
        ],
        total_count: 2,
      }),
    });

    await harness.ns.search('hello');
    await flushPromises();

    const results = harness.elements['mf-results'];
    expect(results.children).toHaveLength(2);
    const firstButton = results.children[0].children[0];
    expect(firstButton.getAttribute('data-memory-id')).toBe('mem_1');
    expect(firstButton.children[0].textContent).toBe('mem_1 · semantic · 0.81');
    expect(firstButton.children[1].textContent).toBe('first preview');
    expect(results.classList.contains('hidden')).toBe(false);
    expect(harness.elements['mf-status'].textContent).toBe('결과 2건');
  });

  it('clicking a result opens the memory by id', async () => {
    const harness = createMemoryFinderSearchHarness();
    harness.mementoAdminFetch.mockImplementation((url: string) => {
      if (url.startsWith('/admin/memory/search')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              {
                id: 'mem_1',
                type: 'semantic',
                content_preview: 'first preview',
                similarity: 0.8123,
                created_at: 'x',
              },
            ],
            total_count: 1,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ memory: { id: 'mem_1', type: 'semantic', content: 'body' } }),
      });
    });

    await harness.ns.search('hello');
    await flushPromises();

    const firstButton = harness.elements['mf-results'].children[0].children[0];
    firstButton._fireEvent('click');
    await flushPromises();

    const itemFetch = harness.mementoAdminFetch.mock.calls.find(
      (call) => call[0] === '/admin/memory/items/mem_1',
    );
    expect(itemFetch).toBeDefined();
  });

  it('search shows empty message when no items', async () => {
    const harness = createMemoryFinderSearchHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });

    await harness.ns.search('nothing');
    await flushPromises();

    expect(harness.elements['mf-status'].textContent).toBe('검색 결과가 없습니다');
    expect(harness.elements['mf-results'].classList.contains('hidden')).toBe(true);
    expect(harness.elements['mf-results'].children).toHaveLength(0);
  });

  it('search shows validation error after a successful search on 400', async () => {
    const harness = createMemoryFinderSearchHarness();
    harness.mementoAdminFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ id: 'mem_1', type: 'semantic', content_preview: 'ok', similarity: 1, created_at: 'x' }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({}),
      });

    await harness.ns.search('first');
    await flushPromises();

    await harness.ns.search('bad');
    await flushPromises();

    expect(harness.elements['mf-status'].textContent).toBe('검색 조건이 올바르지 않습니다');
    expect(harness.elements['mf-results'].classList.contains('hidden')).toBe(true);
    expect(harness.elements['mf-results'].children).toHaveLength(0);
  });

  it('search surfaces server and network errors', async () => {
    const harness503 = createMemoryFinderSearchHarness();
    harness503.mementoAdminFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    await harness503.ns.search('x');
    await flushPromises();
    expect(harness503.elements['mf-status'].textContent).toBe('검색 엔진을 사용할 수 없습니다');

    const harness500 = createMemoryFinderSearchHarness();
    harness500.mementoAdminFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });
    await harness500.ns.search('x');
    await flushPromises();
    expect(harness500.elements['mf-status'].textContent).toBe('boom');

    const harnessOffline = createMemoryFinderSearchHarness();
    harnessOffline.mementoAdminFetch.mockRejectedValue(new Error('offline'));
    await harnessOffline.ns.search('x');
    await flushPromises();
    expect(harnessOffline.elements['mf-status'].textContent).toBe('offline');
  });

  it('search rejects blank input without fetching', async () => {
    const harness = createMemoryFinderSearchHarness();

    await harness.ns.search('  ');
    await flushPromises();

    expect(harness.elements['mf-status'].textContent).toBe('검색어를 입력하세요');
    expect(harness.mementoAdminFetch).not.toHaveBeenCalled();
  });

  it('search ignores stale responses when a newer search is in flight', async () => {
    const pending = new Map<string, { resolve: (value: unknown) => void }>();
    const harness = createMemoryFinderSearchHarness();
    harness.mementoAdminFetch.mockImplementation(
      (url: string) =>
        new Promise((resolvePromise) => {
          pending.set(url, { resolve: resolvePromise });
        }),
    );

    void harness.ns.search('old');
    void harness.ns.search('new');

    pending.get('/admin/memory/search?q=new&limit=25')!.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ id: 'mem_new', type: 'semantic', content_preview: 'new item', similarity: 0.9, created_at: 'n' }],
      }),
    });
    await flushPromises();

    pending.get('/admin/memory/search?q=old&limit=25')!.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ id: 'mem_old', type: 'semantic', content_preview: 'old item', similarity: 0.9, created_at: 'o' }],
      }),
    });
    await flushPromises();

    const firstButton = harness.elements['mf-results'].children[0]?.children[0];
    expect(firstButton?.getAttribute('data-memory-id')).toBe('mem_new');
  });

  it('search formats non-numeric similarity as em dash', async () => {
    const harness = createMemoryFinderSearchHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ id: 'mem_x', type: 'semantic', content_preview: 'p', similarity: null, created_at: 'x' }],
      }),
    });

    await harness.ns.search('q');
    await flushPromises();

    const head = harness.elements['mf-results'].children[0].children[0].children[0];
    expect(head.textContent.endsWith(' · —')).toBe(true);
  });

  it('mode radios toggle id and search forms', () => {
    const harness = createMemoryFinderSearchHarness();
    harness.initMemoryFinderPanel();

    harness.elements['mf-mode-search'].checked = true;
    for (const fn of harness.changeHandlers['mf-mode-search']) {
      fn();
    }

    expect(harness.elements['mf-id-form'].classList.contains('hidden')).toBe(true);
    expect(harness.elements['mf-search-form'].classList.contains('hidden')).toBe(false);
    expect(harness.elements['mf-results'].classList.contains('hidden')).toBe(true);

    harness.elements['mf-mode-id'].checked = true;
    for (const fn of harness.changeHandlers['mf-mode-id']) {
      fn();
    }

    expect(harness.elements['mf-id-form'].classList.contains('hidden')).toBe(false);
    expect(harness.elements['mf-search-form'].classList.contains('hidden')).toBe(true);
  });

  it('search form submit trims input and calls search with type and limit', async () => {
    const harness = createMemoryFinderSearchHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
    });

    harness.initMemoryFinderPanel();
    harness.elements['mf-search-input'].value = ' 기억 ';
    harness.elements['mf-search-type'].value = 'semantic';
    harness.elements['mf-search-limit'].value = '50';

    const preventDefault = vi.fn();
    expect(harness.searchSubmitHandlers).toHaveLength(1);
    harness.searchSubmitHandlers[0]({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);

    await flushPromises();

    const expected = harness.ns.searchUrl('기억', 'semantic', '50');
    expect(harness.mementoAdminFetch.mock.calls[0][0]).toBe(expected);
  });

  it('initMemoryFinderPanel binds search handlers only once', () => {
    const harness = createMemoryFinderSearchHarness();

    harness.initMemoryFinderPanel();
    harness.initMemoryFinderPanel();

    expect(harness.searchSubmitHandlers).toHaveLength(1);
    expect(harness.changeHandlers['mf-mode-id']).toHaveLength(1);
    expect(harness.changeHandlers['mf-mode-search']).toHaveLength(1);
  });
});
