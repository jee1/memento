import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const tabsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs.js'), 'utf8');
const dashboardCss = readFileSync(resolve(root, 'static/css/dashboard.css'), 'utf8');
const tokensCss = readFileSync(resolve(root, 'static/css/tokens.css'), 'utf8');

const PANEL_SCRIPTS = [
  'agent-sessions-panel-shared.js',
  'agent-sessions-panel-data.js',
  'agent-sessions-panel-render.js',
  'agent-sessions-panel-import.js',
  'agent-sessions-panel.js',
] as const;

const panelJs = PANEL_SCRIPTS.map((name) =>
  readFileSync(resolve(root, 'static/js', name), 'utf8'),
).join('\n');

describe('agent sessions dashboard panel (#460)', () => {
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
});
