/**
 * Dashboard ranking weights panel smoke. The scripts run in a vm sandbox against a minimal fake DOM,
 * so the checks cover what a person sees and the requests the page sends.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const dashboardHtml = read('static/dashboard.html');
const tabsPanelsJs = read('static/js/dashboard-tabs-panels.js');
const tabsInitJs = read('static/js/dashboard-tabs-init.js');
const PANEL_FILES = [
  'static/js/ranking-panel-shared.js',
  'static/js/ranking-panel-render.js',
  'static/js/ranking-panel.js',
];
const panelSources = PANEL_FILES.map(read);

class FakeEl {
  attributes: Record<string, string> = {};
  children: FakeEl[] = [];
  dataset: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  classes = new Set<string>();
  className = '';
  value = '';
  type = '';
  open = false;
  showModal = vi.fn(() => {
    this.open = true;
  });
  close = vi.fn(() => {
    this.open = false;
  });
  private ownText = '';
  constructor(readonly tag: string) {}
  classList = {
    toggle: (name: string, force?: boolean) => {
      if (force === false || (force === undefined && this.classes.has(name))) this.classes.delete(name);
      else this.classes.add(name);
    },
    contains: (name: string) => this.classes.has(name),
  };
  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join(' ');
  }
  set textContent(text: string) {
    this.ownText = text;
    this.children = [];
  }
  appendChild(child: FakeEl) {
    this.children.push(child);
    return child;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  addEventListener(event: string, handler: () => void) {
    (this.listeners[event] ??= []).push(handler);
  }
  fire(event: string) {
    for (const handler of this.listeners[event] ?? []) handler();
  }
  descendants(): FakeEl[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  hidden() {
    return this.classes.has('hidden');
  }
}

const KNOBS = [
  { key: 'ranking_weights.alpha', value: 0.45, file_value: 0.45, min: 0, max: 1, drift: false },
  { key: 'relevance_signal.scale', value: 2, file_value: 2, min: 0.5, max: 3, drift: false },
  { key: 'recency_signal.scale', value: 0.3, file_value: 0.25, min: 0.05, max: 1, drift: true },
];
const PREVIEW = {
  split_version: 'benchmark-v3-split-1',
  dev_query_count: 27,
  changes: { 'relevance_signal.scale': 2.2 },
  current: { ndcg_at_10: 0.8651, mrr: 0.856, recall_at_10: 0.9444, empty_result_rate: 0, p95_latency_ms: 21.9, relevance_tie_rate: 0.0074 },
  proposed: { ndcg_at_10: 0.8437, mrr: 0.8282, recall_at_10: 0.9444, empty_result_rate: 0, p95_latency_ms: 16.6, relevance_tie_rate: 0.0123 },
  delta: { ndcg_at_10: -0.0214, mrr: -0.0278, recall_at_10: 0, empty_result_rate: 0, p95_latency_ms: -5.3, relevance_tie_rate: 0.0049 },
  per_category: {
    incident_ops: { query_count: 4, current: {}, proposed: {}, delta: { ndcg_at_10: -0.1247, mrr: -0.1875, recall_at_10: 0 } },
  },
  tie_gate: { passed: false, reason: 'relevance tie rate 0.0123 > baseline 0.0074 + 0.005' },
};
const COMMANDS = {
  preview: `npm run ranking:preview -- --changes '{"relevance_signal.scale":2.2}'`,
  branch_and_pr: 'git checkout -b ranking/abcdef12 && git apply ranking-abcdef12-x.patch',
};
const CREATED = {
  id: 'abcdef12-0000-4000-8000-000000000000',
  current: { 'relevance_signal.scale': 2 },
  proposed: { 'relevance_signal.scale': 2.2 },
  patch: 'diff',
  commands: COMMANDS,
};
const RECENT = {
  id: '11111111-0000-4000-8000-000000000000',
  actor: 'session:abc',
  reason: '<img src=x onerror=alert(1)>',
  current: { 'recency_signal.scale': 0.3 },
  proposed: { 'recency_signal.scale': 0.25 },
  preview: null,
  previewed_at: null,
  created_at: '2026-11-01T02:00:00.000Z',
  commands: COMMANDS,
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}
type Reply = { status: number; data: unknown };

function createHarness(options: { previewEnabled?: boolean; respond?: (call: Call) => Reply | undefined; sourcePath?: string | null } = {}) {
  const section = dashboardHtml.slice(dashboardHtml.indexOf('id="tab-ranking"'));
  const elements = new Map<string, FakeEl>();
  for (const [, id] of section.matchAll(/\bid="(ranking-[a-z-]+)"/g)) {
    elements.set(id!, new FakeEl(id === 'ranking-dialog' ? 'dialog' : 'div'));
  }
  const calls: Call[] = [];
  const reply = (call: Call): Reply => {
    if (call.method === 'GET' && call.url === '/admin/ranking/weights') {
      return { status: 200, data: { knobs: KNOBS, source_path: options.sourcePath ?? null, preview_enabled: options.previewEnabled ?? false } };
    }
    if (call.method === 'GET') return { status: 200, data: { proposals: [RECENT] } };
    if (call.url.endsWith('/preview')) return { status: 200, data: { id: CREATED.id, preview: PREVIEW, previewed_at: '2026-11-01T03:00:00.000Z', commands: COMMANDS } };
    return { status: 201, data: CREATED };
  };
  const fetchMock = vi.fn(async (url: string, init: { method: string; body?: string } = { method: 'GET' }) => {
    const call = { method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const answer = options.respond?.(call) ?? reply(call);
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.data };
  });
  const clipboard = { writeText: vi.fn(async () => undefined) };
  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: (tag: string) => new FakeEl(tag),
    },
    mementoAdminFetch: fetchMock,
    navigator: { clipboard },
  };
  vm.createContext(sandbox);
  for (const source of panelSources) vm.runInContext(source, sandbox);

  const el = (id: string) => elements.get(id)!;
  const flush = async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  };
  const knobRow = (key: string) => el('ranking-tbody').children.find((row) => row.dataset.key === key)!;
  const input = (key: string) => knobRow(key).descendants().find((node) => node.tag === 'input')!;
  return {
    calls,
    el,
    clipboard,
    knobRow,
    input,
    flush,
    init: async () => {
      (sandbox.initRankingPanel as () => void)();
      await flush();
    },
    click: async (id: string) => {
      el(id).fire('click');
      await flush();
    },
    writes: () => calls.filter((call) => call.method !== 'GET'),
  };
}

describe('dashboard ranking panel', () => {
  it('wires the tab into dashboard.html, the panel list and the tab init, separate from settings', () => {
    expect(dashboardHtml).toMatch(/id="dashboard-tab-ranking" class="m-tab-btn session-only"/);
    expect(dashboardHtml).toContain('data-tab="ranking"');
    expect(dashboardHtml).toMatch(/id="tab-ranking" class="tab-panel session-only"/);
    expect(dashboardHtml.indexOf('id="tab-settings"')).toBeLessThan(dashboardHtml.indexOf('id="tab-ranking"'));
    expect(tabsPanelsJs).toContain("{ name: 'ranking', id: 'tab-ranking' }");
    expect(tabsInitJs).toMatch(/name === 'ranking'[\s\S]*initRankingTab/);
    const order = PANEL_FILES.map((file) => dashboardHtml.indexOf(`/${file}`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('never writes server strings through innerHTML', () => {
    for (const source of panelSources) expect(source).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });

  it('loads knobs and recent proposals once and shows server value, file value, drift and range', async () => {
    const page = createHarness({ sourcePath: '/etc/memento/ranking-weights.toml' });
    await page.init();
    await page.init();
    expect(page.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /admin/ranking/weights',
      'GET /admin/ranking/proposals',
    ]);
    expect(page.el('ranking-tbody').children).toHaveLength(KNOBS.length);
    expect(page.knobRow('relevance_signal.scale').textContent).toContain('범위 [0.5, 3]');
    expect(page.knobRow('recency_signal.scale').textContent).toContain('파일과 다름');
    expect(page.knobRow('relevance_signal.scale').textContent).not.toContain('파일과 다름');
    expect(page.input('relevance_signal.scale').value).toBe('2');
    expect(page.el('ranking-source').hidden()).toBe(false);
    expect(page.el('ranking-source').textContent).toContain('/etc/memento/ranking-weights.toml');
  });

  it('renders recent proposals with server strings as text only', async () => {
    const page = createHarness();
    await page.init();
    const row = page.el('ranking-proposals-tbody').children[0]!;
    expect(row.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(row.textContent).toContain('recency_signal.scale: 0.3 → 0.25');
    expect(row.descendants().some((node) => node.tag === 'img')).toBe(false);
  });

  it('sends nothing when no value differs from the file value or a value is not a number', async () => {
    const page = createHarness();
    await page.init();
    await page.click('ranking-propose-btn');
    expect(page.el('ranking-error').textContent).toContain('바꾼 값이 없습니다');
    expect(page.el('ranking-dialog').open).toBe(false);

    page.input('relevance_signal.scale').value = 'abc';
    await page.click('ranking-propose-btn');
    expect(page.el('ranking-error').textContent).toContain('relevance_signal.scale 는 숫자여야 합니다');
    expect(page.el('ranking-dialog').open).toBe(false);
    expect(page.writes()).toEqual([]);
  });

  it('creates a proposal only after a reason is given and shows patch and commands', async () => {
    const page = createHarness();
    await page.init();
    page.input('relevance_signal.scale').value = '2.2';
    await page.click('ranking-propose-btn');
    expect(page.el('ranking-dialog').open).toBe(true);
    expect(page.el('ranking-dialog-summary').textContent).toContain('relevance_signal.scale: 2 → 2.2');

    await page.click('ranking-dialog-confirm');
    expect(page.el('ranking-dialog-error').hidden()).toBe(false);
    expect(page.writes()).toEqual([]);

    page.el('ranking-dialog-reason').value = '  dev 근거  ';
    await page.click('ranking-dialog-confirm');
    expect(page.writes()).toEqual([
      { method: 'POST', url: '/admin/ranking/proposals', body: { changes: { 'relevance_signal.scale': 2.2 }, reason: 'dev 근거' } },
    ]);
    expect(page.el('ranking-dialog').open).toBe(false);
    expect(page.el('ranking-result').hidden()).toBe(false);
    expect(page.el('ranking-result-title').textContent).toBe('제안 abcdef12');
    expect(page.el('ranking-patch-link').attributes.href).toBe(`/admin/ranking/proposals/${CREATED.id}/patch`);
    expect(page.el('ranking-command-preview').textContent).toBe(COMMANDS.preview);
    expect(page.el('ranking-command-pr').textContent).toBe(COMMANDS.branch_and_pr);
  });

  it('shows the server rejection inside the dialog and keeps it open', async () => {
    const page = createHarness({
      respond: (call) => (call.method === 'POST' ? { status: 400, data: { code: 'INVALID_VALUE', error: '범위 밖' } } : undefined),
    });
    await page.init();
    page.input('relevance_signal.scale').value = '2.2';
    await page.click('ranking-propose-btn');
    page.el('ranking-dialog-reason').value = 'r';
    await page.click('ranking-dialog-confirm');
    expect(page.el('ranking-dialog-error').textContent).toBe('INVALID_VALUE: 범위 밖');
    expect(page.el('ranking-dialog').open).toBe(true);
  });

  describe('preview', () => {
    async function proposed(page: ReturnType<typeof createHarness>) {
      await page.init();
      page.input('relevance_signal.scale').value = '2.2';
      await page.click('ranking-propose-btn');
      page.el('ranking-dialog-reason').value = '근거';
      await page.click('ranking-dialog-confirm');
    }

    it('when the server does not run previews it points to the CLI command instead of offering a run button', async () => {
      const page = createHarness({ previewEnabled: false });
      await proposed(page);
      expect(page.el('ranking-preview-run').hidden()).toBe(true);
      expect(page.el('ranking-preview-disabled').hidden()).toBe(false);
      expect(page.el('ranking-command-preview').textContent).toContain('npm run ranking:preview');
    });

    it('runs the preview and shows current, proposed, delta and the tie gate result', async () => {
      const page = createHarness({ previewEnabled: true });
      await proposed(page);
      expect(page.el('ranking-preview-run').hidden()).toBe(false);
      await page.click('ranking-preview-run');
      expect(page.writes().at(-1)).toEqual({ method: 'POST', url: `/admin/ranking/proposals/${CREATED.id}/preview`, body: undefined });
      expect(page.el('ranking-preview-result').hidden()).toBe(false);
      const ndcg = page.el('ranking-preview-tbody').children.find((row) => row.dataset.metric === 'ndcg_at_10')!;
      expect(ndcg.textContent).toContain('NDCG@10');
      expect(ndcg.textContent).toContain('0.8651');
      expect(ndcg.textContent).toContain('0.8437');
      expect(ndcg.textContent).toContain('-0.0214');
      expect(page.el('ranking-tie-gate').textContent).toContain('동점 게이트 실패');
      expect(page.el('ranking-tie-gate').textContent).toContain('relevance tie rate 0.0123');
      expect(page.el('ranking-category-tbody').children[0]!.textContent).toContain('incident_ops (4)');
      expect(page.el('ranking-preview-scope').textContent).toContain('dev 쿼리 27개');
      expect(page.el('ranking-preview-run').hidden()).toBe(true);
    });

    it('shows a preview failure without losing the proposal', async () => {
      const page = createHarness({
        previewEnabled: true,
        respond: (call) => (call.url.endsWith('/preview') ? { status: 504, data: { code: 'PREVIEW_TIMEOUT', error: '시간 상한' } } : undefined),
      });
      await proposed(page);
      await page.click('ranking-preview-run');
      expect(page.el('ranking-error').textContent).toBe('PREVIEW_TIMEOUT: 시간 상한');
      expect(page.el('ranking-result').hidden()).toBe(false);
      expect(page.el('ranking-preview-run').hidden()).toBe(false);
    });

    it('copies the commands to the clipboard', async () => {
      const page = createHarness();
      await proposed(page);
      await page.click('ranking-copy-pr');
      expect(page.clipboard.writeText).toHaveBeenCalledWith(COMMANDS.branch_and_pr);
      expect(page.el('ranking-copy-status').textContent).toBe('복사했습니다.');
      await page.click('ranking-copy-preview');
      expect(page.clipboard.writeText).toHaveBeenLastCalledWith(COMMANDS.preview);
    });

    it('opens an earlier proposal from the recent list', async () => {
      const page = createHarness();
      await page.init();
      page.el('ranking-proposals-tbody').children[0]!.descendants().find((node) => node.tag === 'button')!.fire('click');
      expect(page.el('ranking-result').hidden()).toBe(false);
      expect(page.el('ranking-result-title').textContent).toBe('제안 11111111');
      expect(page.el('ranking-patch-link').attributes.href).toBe(`/admin/ranking/proposals/${RECENT.id}/patch`);
    });
  });
});
