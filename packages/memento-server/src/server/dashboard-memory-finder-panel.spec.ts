/**
 * Dashboard memory finder panel (#1118).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const memoryFinderPanelJs = readFileSync(resolve(root, 'static/js/memory-finder-panel.js'), 'utf8');
const tabsPanelsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs-panels.js'), 'utf8');
const tabsInitJs = readFileSync(resolve(root, 'static/js/dashboard-tabs-init.js'), 'utf8');
const authTabsJs = readFileSync(resolve(root, 'static/js/dashboard-auth-render-tabs.js'), 'utf8');

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

const MF_ELEMENT_IDS = [
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

type HarnessOptions = {
  locationSearch?: string;
};

async function flushPromises() {
  await new Promise((r) => setTimeout(r, 0));
}

function createMemoryFinderHarness(options: HarnessOptions = {}) {
  const elements: Record<string, any> = {};
  const submitHandlers: Array<(event: { preventDefault: () => void }) => void> = [];

  function createEl(id: string, init: { hidden?: boolean } = {}) {
    const classList = createClassList();
    if (init.hidden) {
      classList.add('hidden');
    }
    const el: Record<string, unknown> = {
      id,
      _textContent: '',
      _value: '',
      scrollTop: 0,
      classList,
      get textContent() {
        return (this as { _textContent: string })._textContent;
      },
      set textContent(value: string) {
        (this as { _textContent: string })._textContent = value;
      },
      get value() {
        return (this as { _value: string })._value;
      },
      set value(value: string) {
        (this as { _value: string })._value = value;
      },
      addEventListener(type: string, fn: (event: { preventDefault: () => void }) => void) {
        if (type === 'submit') {
          submitHandlers.push(fn);
        }
      },
    };
    elements[id] = el;
    return el;
  }

  for (const id of MF_ELEMENT_IDS) {
    createEl(id);
  }
  createEl('mf-detail', { hidden: true });
  createEl('mf-id-form');

  const mementoAdminFetch = vi.fn();
  const sandbox: Record<string, unknown> = {
    console,
    URLSearchParams,
    Error,
    location: { search: options.locationSearch ?? '' },
    document: {
      getElementById: (id: string) => elements[id] ?? null,
    },
    mementoAdminFetch,
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(memoryFinderPanelJs, sandbox);

  const ns = sandbox.__MEMENTO_MEMORY_FINDER__ as {
    open: (memoryId: string) => Promise<void>;
    itemUrl: (memoryId: string) => string;
  };
  const initMemoryFinderPanel = sandbox.initMemoryFinderPanel as () => void;

  return {
    elements,
    ns,
    initMemoryFinderPanel,
    mementoAdminFetch,
    submitHandlers,
    sandbox,
  };
}

function createAuthTabsHarness(locationSearch = '') {
  const activateTab = vi.fn();
  const sandbox: Record<string, unknown> = {
    console,
    URLSearchParams,
    Error,
    location: { search: locationSearch },
    __MEMENTO_DASHBOARD_AUTH_INTERNAL__: {},
    __MEMENTO_DASHBOARD_TABS__: { activateTab },
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(authTabsJs, sandbox);

  const internal = sandbox.__MEMENTO_DASHBOARD_AUTH_INTERNAL__ as {
    maybeActivateTabForAuth: (nextState: string) => void;
  };

  return { activateTab, maybeActivateTabForAuth: internal.maybeActivateTabForAuth };
}

const sampleMemory = {
  id: 'mem_abc',
  type: 'semantic',
  content: 'hello body',
  importance: 0.7,
  privacy_scope: 'private',
  pinned: true,
  created_at: '2026-10-01T00:00:00Z',
  last_accessed: null,
  last_accessed_at: '2026-10-02T00:00:00Z',
  tags: null,
  source: 'cli',
  project_id: null,
  owner_id: 'agent-1',
};

describe('dashboard memory finder panel (#1118)', () => {
  it('wires memory finder tab markup and script in dashboard.html', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-memory-finder"');
    expect(dashboardHtml).toContain('data-tab="memory-finder"');
    expect(dashboardHtml).toContain('id="tab-memory-finder"');
    expect(dashboardHtml).toContain('<script src="/static/js/memory-finder-panel.js"></script>');
    expect(dashboardHtml).toContain('>기억 찾기</button>');

    const reviewIdx = dashboardHtml.indexOf('id="dashboard-tab-review"');
    const finderIdx = dashboardHtml.indexOf('id="dashboard-tab-memory-finder"');
    const jobsIdx = dashboardHtml.indexOf('id="dashboard-tab-jobs"');
    expect(reviewIdx).toBeLessThan(finderIdx);
    expect(finderIdx).toBeLessThan(jobsIdx);
  });

  it('registers memory finder in tab panels and init hook', () => {
    expect(tabsPanelsJs).toContain("'tab-memory-finder'");
    expect(tabsInitJs).toContain('initMemoryFinderPanel');
  });

  it('open renders memory detail on 200 response', async () => {
    const harness = createMemoryFinderHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ memory: sampleMemory }),
    });

    await harness.ns.open('mem_abc');
    await flushPromises();

    expect(harness.mementoAdminFetch).toHaveBeenCalledTimes(1);
    expect(harness.mementoAdminFetch.mock.calls[0][0]).toBe('/admin/memory/items/mem_abc');
    expect(harness.elements['mf-d-id'].textContent).toBe('mem_abc');
    expect(harness.elements['mf-d-type'].textContent).toBe('semantic');
    expect(harness.elements['mf-d-importance'].textContent).toBe('0.7');
    expect(harness.elements['mf-d-pinned'].textContent).toBe('예');
    expect(harness.elements['mf-d-accessed'].textContent).toBe('2026-10-02T00:00:00Z');
    expect(harness.elements['mf-d-tags'].textContent).toBe('—');
    expect(harness.elements['mf-d-project'].textContent).toBe('—');
    expect(harness.elements['mf-d-owner'].textContent).toBe('agent-1');
    expect(harness.elements['mf-d-content'].textContent).toBe('hello body');
    expect(harness.elements['mf-status'].textContent).toBe('');
    expect(harness.elements['mf-detail'].classList.contains('hidden')).toBe(false);
    expect(harness.elements['mf-empty'].classList.contains('hidden')).toBe(true);
  });

  it('open maps pinned false and last_accessed fallback', async () => {
    const harness = createMemoryFinderHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        memory: {
          ...sampleMemory,
          pinned: false,
          last_accessed_at: null,
          last_accessed: '2026-09-30T00:00:00Z',
        },
      }),
    });

    await harness.ns.open('mem_abc');
    await flushPromises();

    expect(harness.elements['mf-d-pinned'].textContent).toBe('아니오');
    expect(harness.elements['mf-d-accessed'].textContent).toBe('2026-09-30T00:00:00Z');
  });

  it('open hides detail after 404 following a successful open', async () => {
    const harness = createMemoryFinderHarness();
    harness.mementoAdminFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ memory: sampleMemory }),
    });

    await harness.ns.open('mem_abc');
    await flushPromises();
    expect(harness.elements['mf-detail'].classList.contains('hidden')).toBe(false);

    harness.mementoAdminFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    await harness.ns.open('mem_missing');
    await flushPromises();

    expect(harness.elements['mf-status'].textContent).toBe('해당 Memory ID 의 기억이 없습니다');
    expect(harness.elements['mf-detail'].classList.contains('hidden')).toBe(true);
  });

  it('open shows invalid id message on 400', async () => {
    const harness = createMemoryFinderHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
    });

    await harness.ns.open('bad-id');
    await flushPromises();

    expect(harness.elements['mf-status'].textContent).toBe('올바른 Memory ID 형식이 아닙니다 (mem_…)');
  });

  it('open surfaces server error body on 500', async () => {
    const harness = createMemoryFinderHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });

    await harness.ns.open('mem_err');
    await flushPromises();

    expect(harness.elements['mf-status'].textContent).toBe('boom');
  });

  it('open rejects blank input without fetching', async () => {
    const harness = createMemoryFinderHarness();

    await harness.ns.open('   ');
    await flushPromises();

    expect(harness.elements['mf-status'].textContent).toBe('Memory ID 를 입력하세요');
    expect(harness.mementoAdminFetch).not.toHaveBeenCalled();
  });

  it('open shows network error when fetch rejects', async () => {
    const harness = createMemoryFinderHarness();
    harness.mementoAdminFetch.mockRejectedValue(new Error('offline'));

    await harness.ns.open('mem_offline');
    await flushPromises();

    expect(harness.elements['mf-status'].textContent).toBe('offline');
  });

  it('open ignores stale responses when a newer open is in flight', async () => {
    const pending = new Map<string, { resolve: (value: unknown) => void }>();
    const harness = createMemoryFinderHarness();
    harness.mementoAdminFetch.mockImplementation(
      (url: string) =>
        new Promise((resolvePromise) => {
          pending.set(url, { resolve: resolvePromise });
        }),
    );

    void harness.ns.open('mem_old');
    void harness.ns.open('mem_new');

    pending.get('/admin/memory/items/mem_new')!.resolve({
      ok: true,
      status: 200,
      json: async () => ({ memory: { ...sampleMemory, id: 'mem_new' } }),
    });
    await flushPromises();

    pending.get('/admin/memory/items/mem_old')!.resolve({
      ok: true,
      status: 200,
      json: async () => ({ memory: { ...sampleMemory, id: 'mem_old' } }),
    });
    await flushPromises();

    expect(harness.elements['mf-d-id'].textContent).toBe('mem_new');
  });

  it('itemUrl encodes path separators in memory ids', () => {
    const harness = createMemoryFinderHarness();
    expect(harness.ns.itemUrl('mem_a/b')).toBe('/admin/memory/items/mem_a%2Fb');
  });

  it('form submit trims input and opens the memory', async () => {
    const harness = createMemoryFinderHarness();
    harness.mementoAdminFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ memory: sampleMemory }),
    });

    harness.initMemoryFinderPanel();
    harness.elements['mf-id-input'].value = ' mem_form ';
    const preventDefault = vi.fn();
    expect(harness.submitHandlers).toHaveLength(1);
    harness.submitHandlers[0]({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(harness.mementoAdminFetch.mock.calls[0][0]).toBe('/admin/memory/items/mem_form');
  });

  it('initMemoryFinderPanel consumes deep link once and binds submit once', async () => {
    const harness = createMemoryFinderHarness({ locationSearch: '?memory_id=mem_dl' });
    harness.mementoAdminFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ memory: { ...sampleMemory, id: 'mem_dl' } }),
    });

    harness.initMemoryFinderPanel();
    await flushPromises();

    expect(harness.elements['mf-id-input'].value).toBe('mem_dl');
    expect(harness.mementoAdminFetch).toHaveBeenCalledTimes(1);
    expect(harness.mementoAdminFetch.mock.calls[0][0]).toBe('/admin/memory/items/mem_dl');
    expect(harness.submitHandlers).toHaveLength(1);

    harness.initMemoryFinderPanel();
    await flushPromises();

    expect(harness.mementoAdminFetch).toHaveBeenCalledTimes(1);
    expect(harness.submitHandlers).toHaveLength(1);
  });

  it('maybeActivateTabForAuth opens memory-finder tab for memory_id deep link', () => {
    const { activateTab, maybeActivateTabForAuth } = createAuthTabsHarness('?memory_id=mem_x');
    maybeActivateTabForAuth('signed-in');
    expect(activateTab).toHaveBeenCalledTimes(1);
    expect(activateTab).toHaveBeenCalledWith('memory-finder');
  });

  it('maybeActivateTabForAuth uses default tabs without memory_id deep link', () => {
    const signedIn = createAuthTabsHarness('');
    signedIn.maybeActivateTabForAuth('signed-in');
    expect(signedIn.activateTab).toHaveBeenCalledTimes(1);
    expect(signedIn.activateTab).toHaveBeenCalledWith('anchor');

    const signedOut = createAuthTabsHarness('');
    signedOut.maybeActivateTabForAuth('signed-out');
    expect(signedOut.activateTab).toHaveBeenCalledTimes(1);
    expect(signedOut.activateTab).toHaveBeenCalledWith('evolution-demo');
  });
});
