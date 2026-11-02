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
  set innerHTML(_html: string) {
    this.ownText = '';
    this.children = [];
  }
  appendChild(child: FakeEl) {
    this.children.push(child);
    return child;
  }
  querySelector(selector: string) {
    if (selector === '.sc-detail-col' || selector === '.sc-rationale' || selector === '.sc-judge' || selector === '.sc-apply-hint' || selector === '.sc-btn-apply' || selector === '.sc-btn-restore' || selector === '.sc-btn-dismiss') {
      const el = new FakeEl('div');
      if (selector.includes('btn')) {
        el.disabled = false;
      }
      return el;
    }
    if (selector === '.sc-detail-grid') {
      return this;
    }
    return null;
  }
  querySelectorAll(selector: string) {
    if (selector === '.sc-detail-col') {
      return [new FakeEl('div'), new FakeEl('div')];
    }
    return [];
  }
  addEventListener(event: string, handler: () => void) {
    (this.listeners[event] ??= []).push(handler);
  }
  descendants(): FakeEl[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

const XSS_PAYLOAD = '<img src=x onerror=window.__sc_xss=1>';

function createHarness() {
  const elements = new Map<string, FakeEl>();
  for (const id of ['sc-table-body', 'sc-status-line', 'sc-refresh-btn', 'sc-filter-apply', 'sc-filter-project', 'sc-filter-lifecycle']) {
    elements.set(id, new FakeEl('div'));
  }
  const tbody = new FakeEl('tbody');
  elements.set('sc-table-body', tbody);

  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          id: 'c1',
          lifecycle_status: 'not_applied',
          verdict: 'confirmed',
          project_id: XSS_PAYLOAD,
          old_content_preview: XSS_PAYLOAD,
          new_content_preview: 'safe',
          old_memory_id: 'mem_old',
          new_memory_id: 'mem_new',
          rationale: XSS_PAYLOAD,
          provider: 'gemini',
          model: 'm',
          judged_at: '2026-11-01',
          supersede_apply_enabled: true,
        },
      ],
      pagination: { total_count: 1, page: 1, page_size: 25 },
    }),
  }));

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
    fetchMock,
    sandbox,
    init: async () => {
      (sandbox.initSupersedeCandidatesPanel as () => void)();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    },
  };
}

describe('supersede candidates dashboard panel (#1618)', () => {
  it('wires tab, panel markup, and admin list URL', () => {
    expect(dashboardHtml).toContain('data-tab="supersede"');
    expect(dashboardHtml).toContain('id="tab-supersede-candidates"');
    expect(dashboardHtml).toContain('/static/js/supersede-candidates-panel.js');
    expect(tabsPanels).toContain("'supersede'");
    expect(shared).toContain('/admin/memory/supersede-candidates');
    expect(shared).toContain('mementoAdminFetch');
    expect(shared).toContain('SUPERSEDE_APPLY_ENABLED');
    expect(panel).toContain('/supersede/restore');
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
});
