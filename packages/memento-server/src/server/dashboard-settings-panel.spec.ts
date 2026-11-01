/**
 * Dashboard settings panel smoke. The scripts run in a vm sandbox against a minimal fake DOM,
 * so the checks cover what a person sees and the requests the page sends.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const dashboardHtml = read('static/dashboard.html');
const tabsPanelsJs = read('static/js/dashboard-tabs-panels.js');
const tabsInitJs = read('static/js/dashboard-tabs-init.js');
const PANEL_FILES = [
  'static/js/settings-panel-shared.js',
  'static/js/settings-panel-render.js',
  'static/js/settings-panel.js',
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

interface Setting {
  key: string;
  description: string;
  kind: string;
  allowed?: string[];
  range?: { min: number; max: number; minExclusive?: boolean };
  apply: 'immediate' | 'restart';
  risk: 'low' | 'medium' | 'high';
  value: string | null;
  source: 'override' | 'env' | 'default';
  default_value: string | null;
  default_source: string;
  env_value: string | null;
  override: { value: string; updated_at: string; updated_by: string } | null;
  pending_restart: boolean;
  override_ignored_reason: string | null;
  last_change: { action: string; actor: string; reason: string | null; created_at: string } | null;
}

const base = (overrides: Partial<Setting> & Pick<Setting, 'key'>): Setting => ({
  description: `${overrides.key} 설명`,
  kind: 'boolean',
  allowed: ['true', 'false'],
  apply: 'immediate',
  risk: 'low',
  value: 'false',
  source: 'default',
  default_value: 'false',
  default_source: 'shared/config/index.ts',
  env_value: null,
  override: null,
  pending_restart: false,
  override_ignored_reason: null,
  last_change: null,
  ...overrides,
});

const OVERRIDE = { value: 'true', updated_at: '2026-11-01T01:00:00.000Z', updated_by: 'session:abc' };
const SETTINGS: Setting[] = [
  base({
    key: 'SUPERSEDE_APPLY_ENABLED',
    risk: 'medium',
    value: 'true',
    source: 'override',
    override: OVERRIDE,
    last_change: { action: 'set', actor: 'session:abc', reason: '승인 시작', created_at: '2026-11-01T01:00:00.000Z' },
  }),
  base({ key: 'REFLEXION_OBSERVATION_ONLY' }),
  base({
    key: 'SEARCH_REJECTION_GATE',
    kind: 'enum',
    allowed: ['off', 'typesafe', 'ollama'],
    apply: 'restart',
    risk: 'medium',
    value: 'typesafe',
    default_value: 'off',
    source: 'override',
    override: { ...OVERRIDE, value: 'typesafe' },
    pending_restart: true,
  }),
  base({
    key: 'SEARCH_REJECTION_GATE_THRESHOLD',
    kind: 'number',
    allowed: undefined,
    range: { min: 0, max: 1 },
    value: '0.55',
    default_value: '0.4',
    source: 'env',
    env_value: '0.55',
  }),
  base({
    key: 'MEMENTO_REMEMBER_DEDUP_MODE',
    kind: 'enum',
    allowed: ['warn', 'strict', 'off'],
    value: 'warn',
    default_value: 'warn',
    source: 'env',
    env_value: 'warn',
  }),
  base({
    key: 'LLM_PROVIDER_RELATION_EXTRACTION',
    kind: 'enum',
    allowed: ['jev', 'openai', 'gemini', 'ollama', 'auto'],
    value: null,
    default_value: null,
    override: { ...OVERRIDE, value: 'openai' },
    override_ignored_reason: '[OFFLINE_STRICT_LLM_OVERRIDE_FORBIDDEN] remote provider openai is forbidden',
  }),
  base({
    key: 'LLM_MODEL_RELATION_EXTRACTION',
    kind: 'string',
    allowed: undefined,
    value: null,
    default_value: null,
  }),
];
const READ_ONLY = [
  { key: 'OPENAI_API_KEY', secret: true, set: true, value: 'sk-must-not-show' },
  { key: 'GEMINI_API_KEY', secret: true, set: false, value: null },
  { key: 'EMBEDDING_PROVIDER', secret: false, set: true, value: 'minilm' },
  { key: 'MEMENTO_TOOLSET', secret: false, set: false, value: null },
];
const EVENTS = [
  {
    id: 'e2',
    setting_key: 'SUPERSEDE_APPLY_ENABLED',
    action: 'revert',
    previous_value: 'true',
    new_value: null,
    actor: 'session:b',
    reason: '<img src=x onerror=alert(1)>',
    created_at: '2026-11-01T02:00:00.000Z',
  },
  {
    id: 'e1',
    setting_key: 'SUPERSEDE_APPLY_ENABLED',
    action: 'set',
    previous_value: null,
    new_value: 'true',
    actor: 'session:abc',
    reason: '승인 시작',
    created_at: '2026-11-01T01:00:00.000Z',
  },
];

interface Call {
  method: string;
  url: string;
  body: unknown;
}
type Reply = { status: number; data: unknown };

function createHarness(respond: (call: Call) => Reply | undefined = () => undefined) {
  const settingsSection = dashboardHtml.slice(dashboardHtml.indexOf('id="tab-settings"'));
  const elements = new Map<string, FakeEl>();
  for (const [, id] of settingsSection.matchAll(/\bid="(settings-[a-z-]+)"/g)) {
    elements.set(id!, new FakeEl(id === 'settings-dialog' ? 'dialog' : 'div'));
  }
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, options: { method: string; body?: string } = { method: 'GET' }) => {
    const call = { method: options.method, url, body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    const reply = respond(call) ?? defaultReply(call);
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.data };
  });
  const sandbox: Record<string, unknown> = {
    document: {
      getElementById: (id: string) => elements.get(id) ?? null,
      createElement: (tag: string) => new FakeEl(tag),
    },
    mementoAdminFetch: fetchMock,
  };
  vm.createContext(sandbox);
  for (const source of panelSources) vm.runInContext(source, sandbox);

  const el = (id: string) => elements.get(id)!;
  const rows = () => el('settings-tbody').children;
  const row = (key: string) => rows().find((candidate) => candidate.dataset.key === key)!;
  const buttons = (target: FakeEl) => target.descendants().filter((node) => node.tag === 'button');
  const button = (key: string, label: string) => buttons(row(key)).find((node) => node.textContent === label);
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  return {
    calls,
    el,
    row,
    rows,
    button,
    flush,
    init: async () => {
      (sandbox.initSettingsPanel as () => void)();
      await flush();
    },
    writes: () => calls.filter((call) => call.method !== 'GET'),
  };
}

function defaultReply(call: Call): Reply {
  if (call.method === 'GET' && call.url.startsWith('/admin/settings/events')) {
    return { status: 200, data: { events: EVENTS } };
  }
  if (call.method === 'GET') {
    return { status: 200, data: { settings: SETTINGS, read_only: READ_ONLY } };
  }
  return { status: 200, data: SETTINGS[0] };
}

describe('dashboard settings panel', () => {
  it('wires the tab into dashboard.html, the panel list and the tab init', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-settings"');
    expect(dashboardHtml).toMatch(/id="dashboard-tab-settings" class="m-tab-btn session-only"/);
    expect(dashboardHtml).toContain('data-tab="settings"');
    expect(dashboardHtml).toMatch(/id="tab-settings" class="tab-panel session-only"/);
    expect(dashboardHtml.indexOf('data-tab="jobs"')).toBeLessThan(dashboardHtml.indexOf('data-tab="settings"'));
    expect(tabsPanelsJs).toContain("{ name: 'settings', id: 'tab-settings' }");
    expect(tabsInitJs).toMatch(/name === 'settings'[\s\S]*initSettingsTab/);
    const order = PANEL_FILES.map((file) => dashboardHtml.indexOf(`/${file}`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('never writes server strings through innerHTML', () => {
    for (const source of panelSources) expect(source).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML/);
  });

  describe('table', () => {
    let page: ReturnType<typeof createHarness>;
    beforeEach(async () => {
      page = createHarness();
      await page.init();
    });

    it('loads settings and history once and renders a row per setting', () => {
      expect(page.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        'GET /admin/settings',
        'GET /admin/settings/events',
      ]);
      expect(page.rows()).toHaveLength(SETTINGS.length);
      const text = page.row('SUPERSEDE_APPLY_ENABLED').textContent;
      expect(text).toContain('SUPERSEDE_APPLY_ENABLED 설명');
      expect(text).toContain('true');
      expect(text).toContain('DB');
      expect(text).toContain('위험 중간');
      expect(text).toContain('즉시 반영');
      expect(text).toContain('변경 / session:abc');
      expect(text).toContain('승인 시작');
    });

    it('marks drift for a DB override or a value that differs from the default, and nothing else', () => {
      const drift = (key: string) => page.row(key).textContent.includes('기본값과 다름');
      expect(drift('SUPERSEDE_APPLY_ENABLED')).toBe(true);
      expect(drift('SEARCH_REJECTION_GATE_THRESHOLD')).toBe(true);
      expect(drift('REFLEXION_OBSERVATION_ONLY')).toBe(false);
      expect(drift('MEMENTO_REMEMBER_DEDUP_MODE')).toBe(false);
      expect(drift('LLM_MODEL_RELATION_EXTRACTION')).toBe(false);
      expect(page.row('SEARCH_REJECTION_GATE_THRESHOLD').textContent).toContain('.env');
      expect(page.row('REFLEXION_OBSERVATION_ONLY').textContent).toContain('기본값');
    });

    it('shows restart behavior and the pending badge only where it applies', () => {
      const gate = page.row('SEARCH_REJECTION_GATE').textContent;
      expect(gate).toContain('재기동 필요');
      expect(gate).toContain('재기동 대기');
      expect(page.row('SUPERSEDE_APPLY_ENABLED').textContent).not.toContain('재기동');
    });

    it('shows a stored override that was not applied at boot instead of hiding it behind the effective value', () => {
      const ignored = page.row('LLM_PROVIDER_RELATION_EXTRACTION').textContent;
      expect(ignored).toContain('저장됐지만 적용 안 됨');
      expect(ignored).toContain('OFFLINE_STRICT_LLM_OVERRIDE_FORBIDDEN');
      expect(page.row('SUPERSEDE_APPLY_ENABLED').textContent).not.toContain('적용 안 됨');
    });

    it('offers a revert button only on rows with a DB override', () => {
      for (const setting of SETTINGS) {
        expect(Boolean(page.button(setting.key, '되돌리기')), setting.key).toBe(setting.override !== null);
        expect(Boolean(page.button(setting.key, '변경')), setting.key).toBe(true);
      }
    });

    it('lists read-only entries without ever showing a secret value', () => {
      const text = page.el('settings-readonly-list').textContent;
      expect(text).toContain('OPENAI_API_KEY');
      expect(text).toContain('설정됨(값 가림)');
      expect(text).toContain('미설정');
      expect(text).toContain('minilm');
      expect(text).not.toContain('sk-must-not-show');
    });

    it('renders history as text, so markup in a reason stays inert', () => {
      const tbody = page.el('settings-events-tbody');
      expect(tbody.children).toHaveLength(2);
      expect(tbody.children[0]!.textContent).toContain('<img src=x onerror=alert(1)>');
      expect(tbody.children[0]!.textContent).toContain('되돌림');
      expect(tbody.children[1]!.textContent).toContain('승인 시작');
      expect(tbody.descendants().some((node) => node.tag === 'img')).toBe(false);
      expect(page.el('settings-events-empty').hidden()).toBe(true);
    });

    it('filters history by key', async () => {
      page.el('settings-events-key').value = 'SEARCH_REJECTION_GATE';
      page.el('settings-events-key').fire('change');
      await page.flush();
      expect(page.calls.at(-1)).toMatchObject({
        method: 'GET',
        url: '/admin/settings/events?key=SEARCH_REJECTION_GATE',
      });
    });
  });

  describe('change and revert', () => {
    const edit = (page: ReturnType<typeof createHarness>, key: string, value: string) => {
      const input = page.row(key).descendants().find((node) => node.tag === 'select' || node.tag === 'input')!;
      input.value = value;
      page.button(key, '변경')!.fire('click');
    };
    const confirm = async (page: ReturnType<typeof createHarness>, reason: string) => {
      page.el('settings-dialog-reason').value = reason;
      page.el('settings-dialog-confirm').fire('click');
      await page.flush();
    };

    it('does not ask when the value is unchanged', async () => {
      const page = createHarness();
      await page.init();
      edit(page, 'REFLEXION_OBSERVATION_ONLY', 'false');
      expect(page.el('settings-dialog').showModal).not.toHaveBeenCalled();
      expect(page.el('settings-error').textContent).toContain('현재 값과 같습니다');
      expect(page.writes()).toEqual([]);
    });

    it('asks first, shows old and new value, and sends nothing without a reason', async () => {
      const page = createHarness();
      await page.init();
      edit(page, 'REFLEXION_OBSERVATION_ONLY', 'true');

      expect(page.el('settings-dialog').showModal).toHaveBeenCalledTimes(1);
      expect(page.el('settings-dialog-title').textContent).toContain('REFLEXION_OBSERVATION_ONLY');
      expect(page.el('settings-dialog-summary').textContent).toBe('false → true');
      expect(page.writes()).toEqual([]);

      for (const blank of ['', '   \n']) {
        await confirm(page, blank);
        expect(page.el('settings-dialog-error').textContent).toBe('사유를 입력하세요.');
        expect(page.el('settings-dialog-error').hidden()).toBe(false);
        expect(page.writes(), JSON.stringify(blank)).toEqual([]);
      }
      expect(page.el('settings-dialog').close).not.toHaveBeenCalled();
    });

    it('sends the value and the trimmed reason, closes, then reloads the list and history', async () => {
      const page = createHarness();
      await page.init();
      edit(page, 'REFLEXION_OBSERVATION_ONLY', 'true');
      await confirm(page, '  관찰만 한다  ');

      expect(page.writes()).toEqual([
        { method: 'PUT', url: '/admin/settings/REFLEXION_OBSERVATION_ONLY', body: { value: 'true', reason: '관찰만 한다' } },
      ]);
      expect(page.el('settings-dialog').close).toHaveBeenCalled();
      expect(page.calls.slice(-2).map((call) => `${call.method} ${call.url}`)).toEqual([
        'GET /admin/settings',
        'GET /admin/settings/events',
      ]);
    });

    it('stresses medium and high risk, and restart keys, in the dialog', async () => {
      const page = createHarness();
      await page.init();
      edit(page, 'SEARCH_REJECTION_GATE', 'off');
      const notes = page.el('settings-dialog-notes').children;
      expect(notes.map((note) => note.className)).toEqual(['settings-note settings-note--strong', 'settings-note']);
      expect(notes[0]!.textContent).toContain('위험 중간');
      expect(notes[1]!.textContent).toContain('재기동 후 반영');

      edit(page, 'REFLEXION_OBSERVATION_ONLY', 'true');
      expect(page.el('settings-dialog-notes').children).toHaveLength(0);
    });

    it('shows the code and message of a failed save and keeps the dialog open', async () => {
      const page = createHarness(({ method }) =>
        method === 'PUT' ? { status: 400, data: { code: 'INVALID_VALUE', error: 'must be a decimal number' } } : undefined,
      );
      await page.init();
      const before = page.calls.length;
      edit(page, 'SEARCH_REJECTION_GATE_THRESHOLD', '7');
      await confirm(page, '사유');

      expect(page.el('settings-dialog-error').textContent).toBe('INVALID_VALUE: must be a decimal number');
      expect(page.el('settings-dialog').close).not.toHaveBeenCalled();
      expect(page.calls.length).toBe(before + 1);
    });

    it('reverts through the same dialog, needing a reason, and shows the value it falls back to', async () => {
      const page = createHarness();
      await page.init();
      page.button('SEARCH_REJECTION_GATE', '되돌리기')!.fire('click');

      expect(page.el('settings-dialog-summary').textContent).toBe('typesafe → off');
      expect(page.el('settings-dialog-title').textContent).toContain('되돌리기');
      await confirm(page, '');
      expect(page.writes()).toEqual([]);

      await confirm(page, '원복');
      expect(page.writes()).toEqual([
        { method: 'POST', url: '/admin/settings/SEARCH_REJECTION_GATE/revert', body: { reason: '원복' } },
      ]);
      expect(page.el('settings-dialog').close).toHaveBeenCalled();
    });
  });
});
