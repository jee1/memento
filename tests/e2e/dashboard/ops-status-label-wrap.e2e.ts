import { expect, test, type Page } from '@playwright/test';

// #1716: at 1280px (3-column zones) ops-row labels must stay ≤2 lines — not one glyph per line.

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

  test('ops-row labels stay at most two lines at 1280px', async ({ page }) => {
    await installOpsStatusRoutes(page);
    await page.goto('/dashboard');
    // Width-0 crushed labels count as Playwright "hidden"; wait on attachment + heading.
    await expect(page.getByRole('heading', { name: '정상인가' })).toBeVisible();
    await expect(page.locator('.ops-row[data-key="migration_backup"]')).toHaveCount(1);

    const tall = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.ops-row__label'));
      return labels
        .map((el) => {
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
        })
        .filter((row) => row.lines > 2.15 || row.width < 1);
    });

    expect(tall, `labels taller than 2 lines or width-crushed: ${JSON.stringify(tall)}`).toEqual([]);
  });
});
