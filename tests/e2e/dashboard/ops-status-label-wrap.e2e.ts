import { expect, test, type Page } from '@playwright/test';

// #1716: at 1280px (3-column zones) ops-row labels and values must not glyph-wrap.

const LONG_BACKUP = '2026-11-13T11:33:16.000Z';

const ZONES = {
  system_ok: [
    {
      key: 'process_database',
      value: 'connected',
      unit: null,
      severity: 'ok',
      as_of: null,
      window: { period: '30d' },
    },
    {
      key: 'migration_backup',
      value: LONG_BACKUP,
      unit: null,
      severity: null,
      as_of: null,
      window: null,
    },
    {
      key: 'migration_backup_file_count',
      value: 14,
      unit: 'count',
      severity: null,
      as_of: null,
      window: null,
    },
  ],
  doing_work: [
    {
      key: 'llm_cluster_judge_attempts',
      value: 0,
      unit: 'count',
      severity: null,
      as_of: null,
      window: { period: '7d' },
    },
    {
      key: 'search_query_count',
      value: 464,
      unit: 'count',
      severity: null,
      as_of: null,
      window: { period: '7d' },
    },
  ],
  needs_action: [
    {
      key: 'review_pending_total',
      value: 500,
      unit: 'count',
      severity: 'warn',
      as_of: null,
      window: { period: '30d' },
    },
    {
      key: 'embedding_problem_count',
      value: 12,
      unit: 'count',
      severity: 'warn',
      as_of: null,
      window: { period: '30d' },
    },
  ],
};

async function installOpsStatusRoutes(page: Page): Promise<void> {
  await page.route('**/admin/**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'not mocked' }),
    }),
  );
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/anchors/map?agent_id=default', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ anchors: [], memories: [] }),
    }),
  );
  await page.route('**/static/vendor/d3.v7.min.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  await page.route('**/graph**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }),
  );
  await page.route('**/admin/ops/summary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        zones: ZONES,
        window: { period: '7d', from: null, to: null },
      }),
    }),
  );
}

test.describe('ops-status label wrap (#1716)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('ops-row labels and values stay one line at 1280px', async ({ page }) => {
    await installOpsStatusRoutes(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: '정상인가' })).toBeVisible();
    await expect(page.locator('.ops-row[data-key="review_pending_total"]')).toHaveCount(1);
    await expect(page.locator('.ops-row[data-key="review_pending_total"] .ops-row__link')).toHaveCount(1);

    const report = await page.evaluate(() => {
      const measure = (sel: string) =>
        Array.from(document.querySelectorAll(sel)).map((el) => {
          const cs = getComputedStyle(el);
          const fontSize = parseFloat(cs.fontSize) || 14;
          const lineHeightRaw = cs.lineHeight;
          const lineHeight =
            lineHeightRaw === 'normal' ? fontSize * 1.2 : parseFloat(lineHeightRaw) || fontSize * 1.2;
          const box = el.getBoundingClientRect();
          return {
            text: el.textContent || '',
            width: Math.round(box.width * 10) / 10,
            height: Math.round(box.height * 10) / 10,
            lines: box.height / lineHeight,
          };
        });
      const bad = (rows: Array<{ text: string; width: number; height: number; lines: number }>) =>
        rows.filter((row) => row.lines > 1.15 || row.width < 1);
      return {
        labels: bad(measure('.ops-row__label')),
        values: bad(measure('.ops-row__value')),
      };
    });

    expect(report.labels, `labels not one line: ${JSON.stringify(report.labels)}`).toEqual([]);
    expect(report.values, `values not one line: ${JSON.stringify(report.values)}`).toEqual([]);
  });
});
