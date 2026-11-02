import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const dashboardHtml = readFileSync(resolve(root, 'static/dashboard.html'), 'utf8');
const tabsPanels = readFileSync(resolve(root, 'static/js/dashboard-tabs-panels.js'), 'utf8');
const shared = readFileSync(resolve(root, 'static/js/supersede-candidates-panel-shared.js'), 'utf8');
const panel = readFileSync(resolve(root, 'static/js/supersede-candidates-panel.js'), 'utf8');

describe('supersede candidates dashboard panel (#1618)', () => {
  it('wires tab, panel markup, and admin list URL', () => {
    expect(dashboardHtml).toContain('data-tab="supersede"');
    expect(dashboardHtml).toContain('id="tab-supersede-candidates"');
    expect(dashboardHtml).toContain('/static/js/supersede-candidates-panel.js');
    expect(tabsPanels).toContain("'supersede'");
    expect(shared).toContain('/admin/memory/supersede-candidates');
    expect(shared).toContain('SUPERSEDE_APPLY_ENABLED');
    expect(panel).toContain('/supersede/restore');
  });
});
