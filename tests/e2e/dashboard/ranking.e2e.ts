import { expect, test, type Page } from '@playwright/test';

const KNOBS = [
  { key: 'ranking_weights.alpha', value: 0.45, file_value: 0.45, min: 0, max: 1, drift: false },
  { key: 'relevance_signal.scale', value: 2, file_value: 2, min: 0.5, max: 3, drift: false },
  { key: 'recency_signal.scale', value: 0.3, file_value: 0.25, min: 0.05, max: 1, drift: true },
];
const ID = 'abcdef12-0000-4000-8000-000000000000';
const COMMANDS = {
  preview: `npm run ranking:preview -- --changes '{"relevance_signal.scale":2.2}'`,
  branch_and_pr: `git checkout -b ranking/abcdef12 && git apply ranking-${ID}.patch`,
};
const PREVIEW = {
  split_version: 'benchmark-v3-split-1',
  dev_query_count: 27,
  changes: { 'relevance_signal.scale': 2.2 },
  current: { ndcg_at_10: 0.8651, mrr: 0.856, recall_at_10: 0.9444, empty_result_rate: 0, p95_latency_ms: 21.9, relevance_tie_rate: 0.0074 },
  proposed: { ndcg_at_10: 0.8437, mrr: 0.8282, recall_at_10: 0.9444, empty_result_rate: 0, p95_latency_ms: 16.6, relevance_tie_rate: 0.0123 },
  delta: { ndcg_at_10: -0.0214, mrr: -0.0278, recall_at_10: 0, empty_result_rate: 0, p95_latency_ms: -5.3, relevance_tie_rate: 0.0049 },
  per_category: { incident_ops: { query_count: 4, current: {}, proposed: {}, delta: { ndcg_at_10: -0.1247, mrr: -0.1875, recall_at_10: 0 } } },
  tie_gate: { passed: true },
};

async function installRankingRoutes(page: Page, posts: Array<Record<string, unknown>>): Promise<void> {
  await page.route('**/admin/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) }),
  );
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route('**/static/vendor/d3.v7.min.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  await page.route('**/graph**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }),
  );
  await page.route('**/admin/ranking/weights', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ knobs: KNOBS, source_path: null, preview_enabled: true }),
    }),
  );
  await page.route('**/admin/ranking/proposals', (route) => {
    if (route.request().method() === 'POST') {
      posts.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ID,
          current: { 'relevance_signal.scale': 2 },
          proposed: { 'relevance_signal.scale': 2.2 },
          patch: 'diff',
          commands: COMMANDS,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proposals: [] }) });
  });
  await page.route(`**/admin/ranking/proposals/${ID}/preview`, (route) => {
    posts.push({ url: route.request().url() });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: ID, preview: PREVIEW, previewed_at: '2026-11-01T03:00:00.000Z', commands: COMMANDS }),
    });
  });
}

test.describe('Ranking weights dashboard tab', () => {
  test('proposes only after a reason, then previews and offers the patch and commands', async ({ page }) => {
    const posts: Array<Record<string, unknown>> = [];
    await installRankingRoutes(page, posts);
    await page.goto('/dashboard');
    await page.locator('#dashboard-tab-ranking').click();

    const row = page.locator('#ranking-tbody tr[data-key="relevance_signal.scale"]');
    await expect(row).toBeVisible();
    await expect(page.locator('#ranking-tbody tr[data-key="recency_signal.scale"]')).toContainText('파일과 다름');
    await expect(page.locator('#ranking-result')).toBeHidden();

    await page.locator('#ranking-propose-btn').click();
    await expect(page.locator('#ranking-error')).toContainText('바꾼 값이 없습니다');

    await row.getByLabel('relevance_signal.scale').fill('2.2');
    await page.locator('#ranking-propose-btn').click();
    await expect(page.locator('#ranking-dialog')).toBeVisible();

    await page.locator('#ranking-dialog-confirm').click();
    await expect(page.locator('#ranking-dialog-error')).toBeVisible();
    expect(posts).toEqual([]);

    await page.locator('#ranking-dialog-reason').fill('e2e 사유');
    await page.locator('#ranking-dialog-confirm').click();
    await expect(page.locator('#ranking-dialog')).toBeHidden();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ changes: { 'relevance_signal.scale': 2.2 }, reason: 'e2e 사유' });

    await expect(page.locator('#ranking-result-title')).toHaveText('제안 abcdef12');
    await expect(page.locator('#ranking-patch-link')).toHaveAttribute('href', `/admin/ranking/proposals/${ID}/patch`);
    await expect(page.locator('#ranking-command-preview')).toContainText('npm run ranking:preview');

    await page.locator('#ranking-preview-run').click();
    await expect(page.locator('#ranking-preview-tbody tr[data-metric="ndcg_at_10"]')).toContainText('0.8437');
    await expect(page.locator('#ranking-tie-gate')).toContainText('동점 게이트 통과');
    await expect(page.locator('#ranking-category-tbody')).toContainText('incident_ops (4)');
    await expect(page.locator('#ranking-preview-run')).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('ranking-tab.png'), fullPage: true });
  });
});
