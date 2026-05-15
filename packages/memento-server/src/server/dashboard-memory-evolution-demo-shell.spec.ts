import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const tabsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs.js'), 'utf8');
const shellJs = readFileSync(resolve(root, 'static/js/memory-evolution-demo-shell.js'), 'utf8');
const authJs = readFileSync(resolve(root, 'static/js/dashboard-auth.js'), 'utf8');
const dashboardCss = readFileSync(resolve(root, 'static/css/dashboard.css'), 'utf8');

describe('dashboard memory evolution demo shell (#340, #342, #395)', () => {
  it('dashboard.html includes evolution demo tab, panel, controls, and script', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-evolution-demo"');
    expect(dashboardHtml).toContain('data-tab="evolution-demo"');
    expect(dashboardHtml).toContain('id="tab-evolution-demo"');
    expect(dashboardHtml).toContain('/static/js/memory-evolution-demo-shell.js');
    expect(dashboardHtml).toContain('id="med-loading"');
    expect(dashboardHtml).toContain('id="med-empty"');
    expect(dashboardHtml).toContain('id="med-error"');
    expect(dashboardHtml).toContain('id="med-content"');
    expect(dashboardHtml).toContain('id="med-scenario-select"');
    expect(dashboardHtml).toContain('id="med-point-select"');
    expect(dashboardHtml).toContain('class="med-controls"');
    expect(dashboardHtml).toContain('id="med-question-text"');
    expect(dashboardHtml).toContain('id="med-answer-text"');
    expect(dashboardHtml).toContain('id="med-memory-summary"');
    expect(dashboardHtml).toContain('id="med-explanation-text"');
    expect(dashboardHtml).toContain('기억 진화 데모');
    expect(dashboardHtml).toContain('API에 연동되어 시나리오와 시점을 선택할 수 있습니다');
  });

  it('dashboard.html includes answer-over-time UI shells (#395)', () => {
    expect(dashboardHtml).toContain('id="med-point-segment"');
    expect(dashboardHtml).toContain('id="med-point-controls"');
    expect(dashboardHtml).toContain('id="med-comparison-hint"');
    expect(dashboardHtml).toContain('id="med-memory-stats"');
    expect(dashboardHtml).toContain('왜 답변이 달라지나요?');
    expect(dashboardHtml).toContain('med-section--explanation-prominent');
    expect(dashboardHtml).toContain('med-point-segment');
    expect(dashboardHtml).toContain('role="tablist"');
  });

  it('tab bar: anchor default active; evolution demo last without session-only', () => {
    expect(dashboardHtml).not.toContain('class="m-tab-bar session-only"');
    expect(dashboardHtml).toContain('id="dashboard-tab-anchor" class="m-tab-btn active session-only"');
    expect(dashboardHtml).toContain('id="dashboard-tab-evolution-demo" class="m-tab-btn"');
    expect(dashboardHtml).not.toContain('id="dashboard-tab-evolution-demo" class="m-tab-btn active"');
    expect(dashboardHtml).toContain('id="tab-anchor-map" class="tab-panel active session-only"');
    expect(dashboardHtml).toContain('id="tab-evolution-demo" class="tab-panel"');
    expect(dashboardHtml).not.toMatch(/id="tab-evolution-demo"[^>]*session-only/);
    const evolutionTabIndex = dashboardHtml.indexOf('id="dashboard-tab-evolution-demo"');
    const reviewTabIndex = dashboardHtml.indexOf('id="dashboard-tab-review"');
    expect(evolutionTabIndex).toBeGreaterThan(reviewTabIndex);
  });

  it('dashboard-tabs.js handles evolution-demo via initPanel/refresh', () => {
    expect(tabsJs).toContain("'tab-evolution-demo'");
    expect(tabsJs).toContain("name === 'evolution-demo'");
    expect(tabsJs).toContain('initPanel');
    expect(tabsJs).toContain('refresh');
    expect(tabsJs).toContain('__MEMENTO_DASHBOARD_TABS__');
    expect(tabsJs).toContain('activateTab');
    expect(tabsJs).toContain('__MEMENTO_EVOLUTION_DEMO_SHELL__');
    expect(tabsJs).toContain("data-tab=\"anchor\"");
  });

  it('memory-evolution-demo-shell.js fetches admin evolution demo APIs', () => {
    expect(shellJs).toContain('__MEMENTO_EVOLUTION_DEMO_SHELL__');
    expect(shellJs).toContain('initPanel');
    expect(shellJs).toContain('refresh');
    expect(shellJs).toContain('setViewState');
    expect(shellJs).toContain("'loading'");
    expect(shellJs).toContain("'empty'");
    expect(shellJs).toContain("'error'");
    expect(shellJs).toContain("'ready'");
    expect(shellJs).toContain('mementoAdminFetch');
    expect(shellJs).toContain('/admin/evolution-demo/scenarios');
    expect(shellJs).toContain('/admin/evolution-demo/snapshots/');
    expect(shellJs).toContain('med-scenario-select');
    expect(shellJs).toContain('med-point-select');
    expect(shellJs).toContain('memory_summary');
    expect(shellJs).toContain('explanation');
    expect(shellJs).not.toMatch(/\bfetch\s*\(/);
  });

  it('memory-evolution-demo-shell.js implements answer-over-time UI (#395)', () => {
    expect(shellJs).toContain("ANSWER_OVER_TIME_ID = 'answer-over-time'");
    expect(shellJs).toContain('med-point-segment');
    expect(shellJs).toContain('med-memory-stats');
    expect(shellJs).toContain('med-comparison-hint');
    expect(shellJs).toContain('med-stat-chip');
    expect(shellJs).toContain('renderMemoryStats');
    expect(shellJs).toContain('updateComparisonHint');
    expect(shellJs).toContain('renderPointSegment');
    expect(shellJs).toContain('상세');
    expect(shellJs).toContain('압축');
    expect(shellJs).toContain('semantic 중심');
    expect(shellJs).toContain('episodic_count');
    expect(shellJs).toContain('forgotten_count');
    expect(shellJs).toContain('preserved_count');
  });

  it('dashboard-auth.js activates evolution-demo when signed out', () => {
    expect(authJs).toContain('maybeActivateTabForAuth');
    expect(authJs).toContain("tabs.activateTab('evolution-demo')");
    expect(authJs).toContain("tabs.activateTab('anchor')");
  });

  it('dashboard.css defines med-* layout and controls using design tokens', () => {
    expect(dashboardCss).toContain('.med-layout');
    expect(dashboardCss).toContain('.med-section');
    expect(dashboardCss).toContain('.med-controls');
    expect(dashboardCss).toContain('var(--spacing-md)');
    expect(dashboardCss).toContain('#tab-evolution-demo.tab-panel.active');
  });

  it('dashboard.css defines answer-over-time UI styles (#395)', () => {
    expect(dashboardCss).toContain('.med-point-segment');
    expect(dashboardCss).toContain('.med-stat-chip');
    expect(dashboardCss).toContain('.med-comparison-hint');
    expect(dashboardCss).toContain('.med-section--explanation-prominent');
    expect(dashboardCss).toContain('.med-stat-chip--episodic');
    expect(dashboardCss).toContain('.med-stat-chip--semantic');
    expect(dashboardCss).toContain('var(--color-brand-primary)');
  });
  it('memory-evolution-demo-shell.js gates API load on signed-in auth state', () => {
    expect(shellJs).toContain('canLoadFromApi');
    expect(shellJs).toContain('showAuthRequiredState');
    expect(shellJs).toContain('onAuthStateChanged');
  });

  it('dashboard-auth.js notifies evolution demo shell on auth state change', () => {
    expect(authJs).toContain('onAuthStateChanged');
  });

  it('memory-evolution-demo-shell.js shows comparison hint after ready state', () => {
    const renderIdx = shellJs.indexOf('function renderSnapshot');
    const readyIdx = shellJs.indexOf("setViewState('ready')", renderIdx);
    const hintIdx = shellJs.indexOf('updateComparisonHint', renderIdx);
    expect(readyIdx).toBeGreaterThan(-1);
    expect(hintIdx).toBeGreaterThan(readyIdx);
  });

  it('dashboard.html includes forgetting-policy memory groups section (#344)', () => {
    expect(dashboardHtml).toContain('id="med-memory-groups-section"');
    expect(dashboardHtml).toContain('id="med-memory-groups"');
  });

  it('memory-evolution-demo-shell.js renders forgetting-policy comparison UI (#344)', () => {
    expect(shellJs).toContain('forgetting-policy');
    expect(shellJs).toContain('memory_groups');
    expect(shellJs).toContain('med-memory-groups');
  });

  it('dashboard.css defines forgetting-policy comparison card styles (#344)', () => {
    expect(dashboardCss).toContain('.med-memory-groups');
  });

});
