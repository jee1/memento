import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const dashboardHtml = read('static/dashboard.html');
const tabsPanels = read('static/js/dashboard-tabs-panels.js');
const shared = read('static/js/supersede-candidates-panel-shared.js');
const panel = read('static/js/supersede-candidates-panel.js');
const PANEL_FILES = ['static/js/supersede-candidates-panel-shared.js', 'static/js/supersede-candidates-panel.js'];

class FakeEl {
  attributes: Record<string, string> = {};
  children: FakeEl[] = [];
  dataset: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  classes = new Set<string>();
  className = '';
  value = '';
  disabled = false;
  open = false;
  private ownText = '';
  constructor(readonly tag: string) {}
  classList = {
    toggle: (name: string, force?: boolean) => {
      if (force === false || (force === undefined && this.classes.has(name))) this.classes.delete(name);
      else this.classes.add(name);
    },
    contains: (name: string) => this.classes.has(name),
    add: (name: string) => {
      this.classes.add(name);
    },
    remove: (name: string) => {
      this.classes.delete(name);
    },
  };
  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join(' ');
  }
  set textContent(text: string) {
    this.ownText = text;
    this.children = [];
  }
  set innerHTML(html: string) {
    this.ownText = '';
    this.children = [];
    const stack: FakeEl[] = [this];
    for (const match of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/g)) {
      if (match[1]) {
        stack.pop();
      } else {
        const el = new FakeEl(match[2]!);
        el.className = /class="([^"]*)"/.exec(match[3]!)?.[1] ?? '';
        el.className.split(' ').filter(Boolean).forEach((name) => el.classes.add(name));
        stack.at(-1)!.appendChild(el);
        stack.push(el);
      }
    }
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  removeChild(child: FakeEl) {
    this.children.splice(this.children.indexOf(child), 1);
  }
  appendChild(child: FakeEl) {
    this.children.push(child);
    return child;
  }
  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeEl[] {
    return this.descendants().filter((el) => el.classes.has(selector.slice(1)));
  }
  addEventListener(event: string, handler: () => void) {
    (this.listeners[event] ??= []).push(handler);
  }
  descendants(): FakeEl[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

const XSS_PAYLOAD = '<img src=x onerror=window.__sc_xss=1>';

const OLD_CONTENT = '옛 기억 '.repeat(60) + '\n마지막 조건 ' + XSS_PAYLOAD;
const NEW_CONTENT = '새 기억 '.repeat(60) + '\n최종 지시 ' + XSS_PAYLOAD;
const CANDIDATE = {
  id: 'c1',
  lifecycle_status: 'not_applied',
  verdict: 'confirmed',
  project_id: XSS_PAYLOAD,
  old_content_preview: OLD_CONTENT.slice(0, 200),
  new_content_preview: NEW_CONTENT.slice(0, 200),
  old_memory_id: 'mem_old',
  new_memory_id: 'mem_new',
  old_superseded_by: null as string | null,
  rationale: XSS_PAYLOAD,
  evidence_quote: XSS_PAYLOAD,
  provider: 'gemini',
  model: 'm',
  judged_at: '2026-11-01',
  supersede_apply_enabled: true,
};

function memoryResponse(content: string) {
  return { ok: true, status: 200, json: async () => ({ memory: { content } }) };
}
type MemoryResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

async function flushPromises() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

function createHarness(
  loadMemory = async (id: string): Promise<MemoryResponse> => memoryResponse(id === 'mem_old' ? OLD_CONTENT : NEW_CONTENT),
  candidates = [CANDIDATE],
) {
  const elements = new Map<string, FakeEl>();
  for (const id of ['sc-detail', 'sc-table-body', 'sc-status-line', 'sc-refresh-btn', 'sc-filter-apply', 'sc-filter-project', 'sc-filter-lifecycle']) {
    elements.set(id, new FakeEl('div'));
  }
  const section = new FakeEl('details');
  section.open = true;
  elements.set('rc-supersede-section', section);
  const tbody = elements.get('sc-table-body')!;
  const detail = elements.get('sc-detail')!;
  const restoreBodies: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    if (url.includes('/supersede/restore')) {
      if (init?.body) {
        restoreBodies.push(init.body);
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.includes('/supersede-candidates/') && url.endsWith('/apply')) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.startsWith('/admin/memory/items/') && !url.includes('/supersede')) {
      return loadMemory(decodeURIComponent(url.split('/').at(-1)!));
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates, pagination: { total_count: candidates.length, page: 1, page_size: 25 } }),
    };
  });

  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: (tag: string) => new FakeEl(tag),
    },
    mementoAdminFetch: fetchMock,
    window: {} as Record<string, unknown>,
    prompt: vi.fn(() => '거절 사유'),
    __sc_xss: undefined as number | undefined,
  };
  sandbox.window = sandbox;
  sandbox.prompt = vi.fn(() => '거절 사유');
  vm.createContext(sandbox);
  vm.runInContext(shared, sandbox);
  vm.runInContext(panel, sandbox);

  return {
    tbody,
    detail,
    section,
    elements,
    fetchMock,
    restoreBodies,
    sandbox,
    init: async () => {
      (sandbox.initSupersedeCandidatesPanel as () => void)();
      await flushPromises();
    },
  };
}

describe('supersede candidates dashboard panel (#1618)', () => {
  it('wires tab, panel markup, and admin list URL', () => {
    const reviewPanel = dashboardHtml.slice(
      dashboardHtml.indexOf('id="tab-review-candidates"'),
      dashboardHtml.indexOf('id="tab-memory-finder"'),
    );
    expect(reviewPanel).toContain('<details id="rc-supersede-section"');
    expect(reviewPanel).toContain('id="sc-table-body"');
    expect(dashboardHtml).not.toContain('data-tab="supersede"');
    expect(dashboardHtml).not.toContain('id="tab-supersede-candidates"');
    expect(dashboardHtml).toContain('/static/js/supersede-candidates-panel.js');
    expect(tabsPanels).not.toContain("'supersede'");
    expect(shared).toContain('/admin/memory/supersede-candidates');
    expect(shared).toContain('mementoAdminFetch');
    expect(shared).toContain('대체 승인이 꺼져 있어');
    expect(panel).toContain('/supersede/restore');
  });

  it('loads the list only while the section is open', async () => {
    const page = createHarness();
    page.section.open = false;
    await page.init();
    expect(page.fetchMock).not.toHaveBeenCalled();

    page.section.open = true;
    page.section.listeners.toggle!.forEach((handler) => handler());
    await flushPromises();
    expect(page.fetchMock.mock.calls.map(([url]) => url)).toContain('/admin/memory/supersede-candidates?page_size=25&page=1');
  });

  it('shows verdicts and lifecycle states in Korean', async () => {
    const page = createHarness();
    await page.init();
    expect(page.tbody.textContent).toContain('확정 대체');
    expect(page.tbody.textContent).not.toContain('confirmed');
    expect(page.tbody.textContent).toContain('미적용');
  });

  it('does not assign candidate list cells through innerHTML', () => {
    expect(panel).not.toMatch(/tr\.innerHTML/);
  });

  it('renders list previews as text without executing HTML in candidate content', async () => {
    const page = createHarness();
    await page.init();
    expect(page.fetchMock).toHaveBeenCalled();
    expect(page.tbody.children).toHaveLength(1);
    const row = page.tbody.children[0]!;
    expect(row.textContent).toContain(XSS_PAYLOAD);
    expect(row.descendants().some((node) => node.tag === 'img')).toBe(false);
    expect(page.sandbox.__sc_xss).toBeUndefined();
  });

  it('shows both complete bodies beyond the 200-character list previews as text', async () => {
    const page = createHarness();
    await page.init();
    const bodies = page.detail.querySelectorAll('.sc-preview');
    expect(bodies.map((el) => el.textContent)).toEqual([OLD_CONTENT, NEW_CONTENT]);
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(false);
    expect(page.fetchMock.mock.calls.map(([url]) => url)).toContain('/admin/memory/items/mem_old');
    expect(page.fetchMock.mock.calls.map(([url]) => url)).toContain('/admin/memory/items/mem_new');
    expect(page.detail.descendants().some((node) => node.tag === 'img')).toBe(false);
    expect(page.sandbox.__sc_xss).toBeUndefined();
  });

  it('#1640: shows evidence_quote as textContent without interpreting HTML', async () => {
    const page = createHarness();
    await page.init();
    const quoteEl = page.detail.querySelector('.sc-evidence-quote')!;
    expect(quoteEl.textContent).toBe(XSS_PAYLOAD);
    expect(quoteEl.descendants().some((node) => node.tag === 'img')).toBe(false);
    expect(page.sandbox.__sc_xss).toBeUndefined();
  });

  it.each([null, '', '   '])('#1640: shows missing evidence label when quote is %j', async (quote) => {
    const page = createHarness(undefined, [{ ...CANDIDATE, evidence_quote: quote }]);
    await page.init();
    expect(page.detail.querySelector('.sc-evidence-quote')!.textContent).toBe('인용 근거 없음');
  });

  it('blocks approval until both memory bodies finish loading', async () => {
    let finishNew!: (response: MemoryResponse) => void;
    const page = createHarness(async (id) => id === 'mem_old'
      ? memoryResponse(OLD_CONTENT)
      : new Promise((resolve) => { finishNew = resolve; }));
    await page.init();
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(true);
    expect(page.detail.textContent).toContain('본문을 불러오는 중');
    finishNew(memoryResponse(NEW_CONTENT));
    await flushPromises();
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(false);
    expect(page.detail.textContent).not.toContain('본문을 불러오는 중');
  });

  it.each(['mem_old', 'mem_new'])('blocks approval and explains a missing body: %s', async (missingId) => {
    const page = createHarness(async (id) => id === missingId
      ? { ok: false, status: 404, json: async () => ({ error: 'Memory not found' }) }
      : memoryResponse(OLD_CONTENT));
    await page.init();
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(true);
    expect(page.detail.textContent).toContain('전체 본문을 불러오지 못해 승인할 수 없습니다');
    expect(page.detail.textContent).toContain('삭제되었거나 조회에 실패');
  });

  it.each(['network', 'invalid-json', 'missing-content'])('blocks approval on %s errors', async (failure) => {
    const page = createHarness(async () => {
      if (failure === 'network') throw new Error('offline');
      return { ok: true, status: 200, json: async () => {
        if (failure === 'invalid-json') throw new SyntaxError('invalid JSON');
        return { memory: {} };
      } };
    });
    await page.init();
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(true);
    expect(page.detail.textContent).toContain('전체 본문을 불러오지 못해 승인할 수 없습니다');
  });

  it.each([
    { supersede_apply_enabled: false },
    { lifecycle_status: 'applied' },
    { lifecycle_status: 'dismissed' },
    { lifecycle_status: 'target_deleted' },
    { lifecycle_status: 'dangling_pointer' },
    { old_superseded_by: 'mem_other_target', new_memory_id: 'mem_new' },
  ])('preserves existing apply restrictions after loading: %j', async (overrides) => {
    const page = createHarness(undefined, [{ ...CANDIDATE, ...overrides }]);
    await page.init();
    expect(page.detail.querySelectorAll('.sc-preview').map((el) => el.textContent)).toEqual([OLD_CONTENT, NEW_CONTENT]);
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(true);
  });

  it('keeps a late response from overwriting the newly selected candidate', async () => {
    const pending: Array<(response: MemoryResponse) => void> = [];
    const page = createHarness(async (id) => id.startsWith('mem_other')
      ? memoryResponse('다른 후보 전체 본문')
      : new Promise((resolve) => pending.push(resolve)), [
      CANDIDATE,
      { ...CANDIDATE, id: 'c2', old_memory_id: 'mem_other_old', new_memory_id: 'mem_other_new' },
    ]);
    await page.init();
    page.tbody.children[1]!.listeners.click![0]!();
    await flushPromises();
    pending.forEach((finish) => finish(memoryResponse('이전 후보 본문')));
    await flushPromises();
    expect(page.detail.querySelectorAll('.sc-preview').map((el) => el.textContent)).toEqual([
      '다른 후보 전체 본문', '다른 후보 전체 본문',
    ]);
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(false);
  });

  it('#1645 I1: blocks apply for compatible verdict after bodies load', async () => {
    const page = createHarness(undefined, [{ ...CANDIDATE, verdict: 'compatible' }]);
    await page.init();
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(true);
    const hint = page.detail.descendants().find((el) => el.classes.has('sc-apply-hint'));
    expect(hint && !hint.classes.has('hidden')).toBe(true);
    expect(hint?.textContent).toContain('비승인');
  });

  it('#1645 I1: dangling restore sends expected_new_memory_id from old_superseded_by', async () => {
    const page = createHarness(undefined, [
      {
        ...CANDIDATE,
        lifecycle_status: 'dangling_pointer',
        old_superseded_by: 'mem_gone',
        new_memory_id: 'mem_list_new',
      },
    ]);
    await page.init();
    expect(page.detail.querySelector('.sc-btn-restore')!.disabled).toBe(false);
    expect(page.detail.querySelector('.sc-btn-dismiss')!.disabled).toBe(false);
    page.detail.querySelector('.sc-btn-restore')!.listeners.click![0]!();
    await flushPromises();
    expect(page.restoreBodies.some((b) => b.includes('"expected_new_memory_id":"mem_gone"'))).toBe(true);
  });

  it('#1647 I1: target_deleted keeps dismiss disabled until restore; hint names order', async () => {
    const page = createHarness(undefined, [{ ...CANDIDATE, lifecycle_status: 'target_deleted', old_superseded_by: 'mem_new' }]);
    await page.init();
    const hint = page.detail.descendants().find((el) => el.classes.has('sc-apply-hint'));
    expect(hint?.textContent).toContain('먼저 되돌린 뒤 거절하세요');
    expect(hint?.textContent).toContain('복구되기 전까지 서버에서 거절');
    expect(shared).toContain('먼저 되돌린 뒤 거절하세요');
    expect(page.detail.querySelector('.sc-btn-dismiss')!.disabled).toBe(true);
    expect(page.detail.querySelector('.sc-btn-restore')!.disabled).toBe(false);
  });

  it('#1647 I1: restored row enables dismiss after pointer cleared', async () => {
    const page = createHarness(undefined, [{ ...CANDIDATE, lifecycle_status: 'restored', old_superseded_by: null }]);
    await page.init();
    expect(page.detail.querySelector('.sc-btn-dismiss')!.disabled).toBe(false);
  });

  it('#1646: not_applied row with old_superseded_by pointing elsewhere blocks apply', async () => {
    const page = createHarness(undefined, [
      {
        ...CANDIDATE,
        lifecycle_status: 'not_applied',
        old_superseded_by: 'mem_live_target',
        new_memory_id: 'mem_other_new',
      },
    ]);
    await page.init();
    expect(page.detail.querySelector('.sc-btn-apply')!.disabled).toBe(true);
    const hint = page.detail.descendants().find((el) => el.classes.has('sc-apply-hint'));
    expect(hint?.textContent).toContain('이미 다른 대상');
  });
});
