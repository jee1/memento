import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const tabsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs.js'), 'utf8');
const shellJs = readFileSync(resolve(root, 'static/js/memory-evolution-demo-shell.js'), 'utf8');
const authJs = readFileSync(resolve(root, 'static/js/dashboard-auth.js'), 'utf8');
const dashboardCss = readFileSync(resolve(root, 'static/css/dashboard.css'), 'utf8');

describe('dashboard memory evolution demo shell (#340)', () => {
  it('dashboard.html includes evolution demo tab, panel, and script', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-evolution-demo"');
    expect(dashboardHtml).toContain('data-tab="evolution-demo"');
    expect(dashboardHtml).toContain('id="tab-evolution-demo"');
    expect(dashboardHtml).toContain('/static/js/memory-evolution-demo-shell.js');
    expect(dashboardHtml).toContain('id="med-loading"');
    expect(dashboardHtml).toContain('id="med-empty"');
    expect(dashboardHtml).toContain('id="med-error"');
    expect(dashboardHtml).toContain('id="med-content"');
    expect(dashboardHtml).toContain('id="med-question-text"');
    expect(dashboardHtml).toContain('id="med-answer-text"');
    expect(dashboardHtml).toContain('id="med-memory-summary"');
    expect(dashboardHtml).toContain('기억 진화 데모');
  });

  it('tab bar is visible without session; session tabs keep session-only', () => {
    expect(dashboardHtml).not.toContain('class="m-tab-bar session-only"');
    expect(dashboardHtml).toContain('id="dashboard-tab-evolution-demo" class="m-tab-btn active"');
    expect(dashboardHtml).toContain('id="dashboard-tab-anchor" class="m-tab-btn session-only"');
    expect(dashboardHtml).toContain('id="dashboard-tab-review" class="m-tab-btn session-only"');
    expect(dashboardHtml).not.toMatch(/id="tab-evolution-demo"[^>]*session-only/);
    expect(dashboardHtml).toContain('id="tab-anchor-map" class="tab-panel session-only"');
  });

  it('dashboard-tabs.js handles evolution-demo and exports activateTab', () => {
    expect(tabsJs).toContain("'tab-evolution-demo'");
    expect(tabsJs).toContain("name === 'evolution-demo'");
    expect(tabsJs).toContain('__MEMENTO_DASHBOARD_TABS__');
    expect(tabsJs).toContain('activateTab');
    expect(tabsJs).toContain('__MEMENTO_EVOLUTION_DEMO_SHELL__');
  });

  it('memory-evolution-demo-shell.js exposes view state API (shell only)', () => {
    expect(shellJs).toContain('__MEMENTO_EVOLUTION_DEMO_SHELL__');
    expect(shellJs).toContain('setViewState');
    expect(shellJs).toContain("'loading'");
    expect(shellJs).toContain("'empty'");
    expect(shellJs).toContain("'error'");
    expect(shellJs).toContain("'ready'");
    expect(shellJs).not.toContain('fetch(');
  });

  it('dashboard-auth.js activates evolution-demo when signed out', () => {
    expect(authJs).toContain('maybeActivateTabForAuth');
    expect(authJs).toContain("tabs.activateTab('evolution-demo')");
    expect(authJs).toContain("tabs.activateTab('anchor')");
  });

  it('dashboard.css defines med-* layout using design tokens', () => {
    expect(dashboardCss).toContain('.med-layout');
    expect(dashboardCss).toContain('.med-section');
    expect(dashboardCss).toContain('var(--spacing-md)');
    expect(dashboardCss).toContain('#tab-evolution-demo.tab-panel.active');
  });
});
