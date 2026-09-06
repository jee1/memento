import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const DASHBOARD_TABS_SCRIPTS = [
  'dashboard-tabs-panels.js',
  'dashboard-tabs-init.js',
  'dashboard-tabs.js',
] as const;

const tabsJs = DASHBOARD_TABS_SCRIPTS.map((name) =>
  readFileSync(resolve(root, 'static/js', name), 'utf8'),
).join('\n');
const dashboardCss = readFileSync(resolve(root, 'static/css/dashboard.css'), 'utf8');
const tokensCss = readFileSync(resolve(root, 'static/css/tokens.css'), 'utf8');

const PANEL_SCRIPTS = [
  'agent-sessions-panel-shared.js',
  'agent-sessions-panel-data.js',
  'agent-sessions-panel-render-dom.js',
  'agent-sessions-panel-render-sessions.js',
  'agent-sessions-panel-render-timeline-category.js',
  'agent-sessions-panel-render-timeline.js',
  'agent-sessions-panel-render-injections.js',
  'agent-sessions-panel-render-provenance.js',
  'agent-sessions-panel-render.js',
  'agent-sessions-panel-import.js',
  'agent-sessions-panel.js',
] as const;

const panelJs = PANEL_SCRIPTS.map((name) =>
  readFileSync(resolve(root, 'static/js', name), 'utf8'),
).join('\n');
const panelDataJs = readFileSync(
  resolve(root, 'static/js/agent-sessions-panel-data.js'),
  'utf8',
);

describe('agent sessions dashboard panel (#460)', () => {
  it('does not render stale A detail, injections, or timeline after selecting B (#883)', async () => {
    const deferred = new Map<string, { resolve: (value: unknown) => void }>();
    const rendered = { detail: [] as string[], injections: [] as string[], timeline: [] as string[] };
    const state = {
      selectedSessionId: null as string | null,
      observationCursor: null as string | null,
      detailGeneration: 0,
      timelineGeneration: 0,
    };
    const sandbox: Record<string, any> = {
      __MEMENTO_AGENT_SESSIONS_PANEL__: {
        state,
        $: () => ({ value: '' }),
        agentFetch: vi.fn(
          (url: string) =>
            new Promise((resolve) => deferred.set(url, { resolve })),
        ),
        queryString: () => '',
        renderSessionSelection: vi.fn(),
        setViewState: vi.fn(),
        setHidden: vi.fn(),
        renderSessionDetail: (session: { id: string }) => rendered.detail.push(session.id),
        renderInjections: (items: Array<{ id: string }>) => rendered.injections.push(items[0]?.id),
        renderTimeline: (items: Array<{ id: string }>) => rendered.timeline.push(items[0]?.id),
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInContext(panelDataJs, vm.createContext(sandbox), {
      filename: 'agent-sessions-panel-data.js',
    });
    const ns = sandbox.__MEMENTO_AGENT_SESSIONS_PANEL__;
    const a = ns.selectSession('a');
    const b = ns.selectSession('b');
    const resolveSession = (id: string) => {
      deferred.get('/api/v1/agent/sessions/' + id)!.resolve({ session: { id } });
      deferred.get('/api/v1/agent/sessions/' + id + '/observations')!.resolve({
        observations: [{ id }],
        next_cursor: null,
      });
      deferred.get('/api/v1/agent/sessions/' + id + '/injections')!.resolve({
        injections: [{ id }],
      });
    };

    resolveSession('b');
    await b;
    resolveSession('a');
    await a;

    expect(rendered).toEqual({
      detail: ['b'],
      injections: ['b'],
      timeline: ['b'],
    });
    expect(state.selectedSessionId).toBe('b');
  });

  it('does not let an older timeline refresh overwrite a newer one (#883)', async () => {
    const deferred: Array<{ resolve: (value: unknown) => void }> = [];
    const rendered: string[] = [];
    const sandbox: Record<string, any> = {
      __MEMENTO_AGENT_SESSIONS_PANEL__: {
        state: {
          selectedSessionId: 'b',
          observationCursor: null,
          detailGeneration: 1,
          timelineGeneration: 0,
        },
        $: () => ({ value: '' }),
        agentFetch: () => new Promise((resolve) => deferred.push({ resolve })),
        queryString: () => '',
        renderTimeline: (items: Array<{ id: string }>) => rendered.push(items[0]?.id),
        setHidden: vi.fn(),
      },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInContext(panelDataJs, vm.createContext(sandbox), {
      filename: 'agent-sessions-panel-data.js',
    });
    const ns = sandbox.__MEMENTO_AGENT_SESSIONS_PANEL__;
    const first = ns.loadTimeline(false);
    const second = ns.loadTimeline(false);
    deferred[1].resolve({ observations: [{ id: 'newer' }], next_cursor: null });
    await second;
    deferred[0].resolve({ observations: [{ id: 'older' }], next_cursor: null });
    await first;

    expect(rendered).toEqual(['newer']);
  });

  it('registers the tab, panel, state shells, and companion scripts', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-agent-sessions"');
    expect(dashboardHtml).toContain('data-tab="agent-sessions"');
    expect(dashboardHtml).toContain('id="tab-agent-sessions"');
    expect(dashboardHtml).toContain('id="as-loading"');
    expect(dashboardHtml).toContain('id="as-empty"');
    expect(dashboardHtml).toContain('id="as-error"');
    expect(dashboardHtml).toContain('id="as-session-list"');
    expect(dashboardHtml).toContain('id="as-timeline"');
    expect(dashboardHtml).toContain('id="as-injections"');
    expect(dashboardHtml).toContain('id="as-provenance-results"');
    for (const name of PANEL_SCRIPTS) {
      expect(dashboardHtml).toContain(`/static/js/${name}`);
    }
  });

  it('activates the panel through the shared dashboard tabs controller', () => {
    expect(tabsJs).toContain("'tab-agent-sessions'");
    expect(tabsJs).toContain("name === 'agent-sessions'");
    expect(tabsJs).toContain('initAgentSessionsPanel');
  });

  it('keeps the programmatic key in memory and sends it only as a request header', () => {
    expect(panelJs).toContain('programmaticApiKey');
    expect(panelJs).toContain('Authorization');
    expect(panelJs).toContain("'Bearer ' + state.programmaticApiKey");
    expect(panelJs).not.toContain('localStorage');
    expect(panelJs).not.toContain('sessionStorage');
    expect(panelJs).not.toContain('document.cookie');
  });

  it('supports session pagination, timeline filters, provenance, and injection detail', () => {
    expect(panelJs).toContain('/api/v1/agent/sessions');
    expect(panelJs).toContain('/observations');
    expect(panelJs).toContain('/injections');
    expect(panelJs).toContain('/api/v1/agent/provenance/detail');
    expect(panelJs).toContain('next_cursor');
    expect(panelJs).toContain('item.session');
    expect(panelJs).toContain('event_type');
    expect(panelJs).toContain('status');
    expect(panelJs).toContain('score');
    expect(panelJs).toContain('token_estimate');
    expect(panelJs).toContain('used');
  });

  it('requires a successful dry-run before an explicit transcript import', () => {
    expect(dashboardHtml).toContain('id="as-transcript-file"');
    expect(dashboardHtml).toContain('id="as-transcript-jsonl"');
    expect(dashboardHtml).toContain('id="as-transcript-dry-run"');
    expect(dashboardHtml).toContain('id="as-transcript-import"');
    expect(panelJs).toContain('/api/v1/agent/transcripts/import');
    expect(panelJs).toContain('dry_run: true');
    expect(panelJs).toContain('dry_run: false');
    expect(panelJs).toContain('validatedTranscript');
  });

  it('renders safe metadata and explicit operational states without raw payload access', () => {
    expect(panelJs).toContain('degraded');
    expect(panelJs).toContain('redacted');
    expect(panelJs).toContain('dropped');
    expect(panelJs).toContain('redaction_count');
    expect(panelJs).toContain('drop_reason');
    expect(panelJs).toContain('textContent');
    expect(panelJs).not.toContain('payload_json');
    expect(panelJs).not.toContain('.innerHTML');
    expect(dashboardHtml).toContain('<option value="DEGRADED">Degraded</option>');
    expect(dashboardHtml).toContain('<option value="REDACTED">Redacted</option>');
  });

  it('uses dedicated design tokens for event and operational state styling', () => {
    expect(tokensCss).toContain('--color-agent-event-prompt');
    expect(tokensCss).toContain('--color-agent-event-tool');
    expect(tokensCss).toContain('--color-agent-event-result');
    expect(tokensCss).toContain('--color-agent-event-error');
    expect(tokensCss).toContain('--color-agent-event-response');
    expect(tokensCss).toContain('--color-agent-event-lifecycle');
    expect(dashboardCss).toContain('.as-event--prompt');
    expect(dashboardCss).toContain('.as-state-badge--redacted');
    expect(dashboardCss).toContain('.as-state-badge--dropped');
    expect(dashboardCss).toContain('var(--color-agent-event-prompt)');
  });

  it('guards stale session detail and timeline responses (#883)', () => {
    expect(panelJs).toContain('detailGeneration: 0');
    expect(panelJs).toContain('const generation = ++ns.state.detailGeneration;');
    expect(panelJs).toContain('generation !== ns.state.detailGeneration');
    expect(panelJs).toContain('ns.state.selectedSessionId !== sessionId');
  });

  it('keeps hidden auth forms invisible and mobile map controls reachable (#883)', () => {
    expect(dashboardCss).toContain('[hidden] {');
    expect(dashboardCss).toContain('display: none !important;');
    expect(dashboardCss).toContain('min-height: 200px;');
    expect(dashboardCss).toMatch(/\.m-tab-bar\s*\{[^}]*overflow-x:\s*auto;/s);
  });
});
