import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REVIEW_QUEUE_DASHBOARD_BOOT_MARKER } from './review-queue-dashboard-boot.js';

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

const PANEL_COMPANION_SCRIPTS = [
  'review-candidates-panel-shared.js',
  'review-candidates-panel-render-preview.js',
  'review-candidates-panel-render-actions.js',
  'review-candidates-panel-render-list.js',
  'review-candidates-panel-render.js',
  'review-candidates-panel-poll.js',
  'review-candidates-panel-health-render.js',
  'review-candidates-panel-health-fetch.js',
  'review-candidates-panel-health.js',
  'review-candidates-panel-bulk.js',
  'review-candidates-panel.js',
] as const;

function readReviewCandidatesPanelSources(): string {
  return PANEL_COMPANION_SCRIPTS.map((name) =>
    readFileSync(resolve(root, 'static/js', name), 'utf8'),
  ).join('\n');
}

const panelJs = readReviewCandidatesPanelSources();

describe('dashboard review candidates panel (#252, #253)', () => {
  it('dashboard.html includes review tab, panel, and script', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-review"');
    expect(dashboardHtml).toContain('data-tab="review"');
    expect(dashboardHtml).toContain('id="tab-review-candidates"');
    expect(dashboardHtml).toContain('/static/js/review-candidates-panel.js');
    for (const name of PANEL_COMPANION_SCRIPTS) {
      expect(dashboardHtml).toContain(`/static/js/${name}`);
    }
    expect(dashboardHtml).toContain(REVIEW_QUEUE_DASHBOARD_BOOT_MARKER);
    expect(dashboardHtml).toContain('id="rc-refresh-btn"');
    expect(dashboardHtml).toContain('class="rc-intro"');
    expect(dashboardHtml).toContain('class="rc-howto"');
    expect(dashboardHtml).toContain('id="rc-health-panel"');
    expect(dashboardHtml).toContain('id="rc-preview-aside"');
    expect(dashboardHtml).toContain('review-candidates-body');
  });

  it('dashboard-tabs.js uses m-tab selectors and review branch', () => {
    expect(tabsJs).toContain('.m-tab-bar');
    expect(tabsJs).toContain('.m-tab-btn');
    expect(tabsJs).not.toContain(".querySelectorAll('.tab-btn')");
    expect(tabsJs).toContain("'tab-review-candidates'");
    expect(tabsJs).toContain('initReviewCandidatesPanel');
  });

  it('review-candidates-panel.js targets pending list and admin memory preview', () => {
    expect(panelJs).toContain('/admin/memory/review-candidates?status=pending');
    expect(panelJs).toContain('/admin/memory/review-candidates/metrics');
    expect(panelJs).toContain('/admin/memory/items/');
    expect(panelJs).toContain('initReviewCandidatesPanel');
  });

  it('review-candidates-panel.js POST review/dismiss paths and dashboard preview actions (#254)', () => {
    expect(panelJs).toContain('/admin/memory/review-candidates/');
    expect(panelJs).toContain('encodeURIComponent');
    expect(panelJs).toContain("postCandidateAction('review')");
    expect(panelJs).toContain("postCandidateAction('dismiss')");
    expect(dashboardHtml).toContain('id="rc-preview-actions"');
    expect(dashboardHtml).toContain('id="rc-btn-review"');
    expect(dashboardHtml).toContain('id="rc-btn-dismiss"');
  });

  it('supports selecting visible candidates and bulk dismiss/expire (#519)', () => {
    expect(dashboardHtml).toContain('id="rc-select-all"');
    expect(dashboardHtml).toContain('id="rc-selected-count"');
    expect(dashboardHtml).toContain('id="rc-bulk-dismiss-btn"');
    expect(dashboardHtml).toContain('id="rc-bulk-expire-btn"');
    expect(panelJs).toContain('/admin/memory/review-candidates/bulk-dismiss');
    expect(panelJs).toContain('/admin/memory/review-candidates/bulk-expire');
    expect(panelJs).toContain('selectedCandidateIds');
    expect(panelJs).toContain('JSON.stringify({ ids: ids })');
    expect(panelJs).toContain('await ns.loadList()');
  });
});

describe('dashboard review queue poll notify (#255)', () => {
  it('dashboard.html includes toast and tab badge placeholders', () => {
    expect(dashboardHtml).toContain('id="rc-toast"');
    expect(dashboardHtml).toContain('id="rc-tab-badge"');
  });

  it('review-candidates-panel.js includes polling helpers (#255, #274)', () => {
    expect(panelJs).toContain('getReviewQueueBoot');
    expect(panelJs).toContain('__MEMENTO_REVIEW_QUEUE__');
    expect(panelJs).toContain('runPollCycle');
    expect(panelJs).toContain('startPollingIfNeeded');
  });
});

describe('dashboard review queue SSE (#276)', () => {
  it('review-candidates-panel.js wires EventSource stream URL and fallback helpers', () => {
    expect(panelJs).toContain('/admin/memory/review-candidates/stream');
    expect(panelJs).toContain('EventSource');
    expect(panelJs).toContain('maybeStartReviewCandidatesEventSource');
    expect(panelJs).toContain('resumePollingAfterStreamLoss');
    expect(panelJs).toContain('schedulePollAfterMsUnlessSse');
  });
});
