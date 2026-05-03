import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const tabsJs = readFileSync(resolve(root, 'static/js/dashboard-tabs.js'), 'utf8');
const panelJs = readFileSync(resolve(root, 'static/js/review-candidates-panel.js'), 'utf8');

describe('dashboard review candidates panel (#252)', () => {
  it('dashboard.html includes review tab, panel, and script', () => {
    expect(dashboardHtml).toContain('id="dashboard-tab-review"');
    expect(dashboardHtml).toContain('data-tab="review"');
    expect(dashboardHtml).toContain('id="tab-review-candidates"');
    expect(dashboardHtml).toContain('/static/js/review-candidates-panel.js');
    expect(dashboardHtml).toContain('id="rc-refresh-btn"');
  });

  it('dashboard-tabs.js uses m-tab selectors and review branch', () => {
    expect(tabsJs).toContain('.m-tab-bar');
    expect(tabsJs).toContain('.m-tab-btn');
    expect(tabsJs).not.toContain(".querySelectorAll('.tab-btn')");
    expect(tabsJs).toContain("'tab-review-candidates'");
    expect(tabsJs).toContain('initReviewCandidatesPanel');
  });

  it('review-candidates-panel.js targets pending list endpoint', () => {
    expect(panelJs).toContain('/admin/memory/review-candidates?status=pending');
    expect(panelJs).toContain('initReviewCandidatesPanel');
  });
});
