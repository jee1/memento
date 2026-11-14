import { expect, test, type Page } from '@playwright/test';

// #1722: review-queue table cells stay inside the card; no glyph wrap. Reuse #1717 measure style (no border on line estimate).

const LONG_MEM = 'mem_1762772305abcdef0123456789deadbeef';
const LONG_CAND = '7dd21418-fd47-4a2b-9c1d-abcdef012345';
const ELIGIBLE =
  'eligible: importance=1.000>=0.4, stale=20d>=14d, anchor=last_recalled_at';

async function installReviewRoutes(page: Page): Promise<void> {
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
  await page.route('**/admin/memory/review-candidates?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            id: LONG_CAND,
            memory_id: LONG_MEM,
            priority: 1300,
            status: 'pending',
            reason: ELIGIBLE,
            due_at: '2026-11-01T12:40:38.000Z',
          },
        ],
        pagination: {
          page: 1,
          page_size: 25,
          total_count: 1,
          total_pages: 1,
          has_prev: false,
          has_next: false,
        },
        timestamp: '2026-11-14T00:00:00Z',
      }),
    }),
  );
  await page.route('**/admin/memory/review-candidates/metrics**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        live: {
          pending_total: 1,
          created_last_1h: 0,
          resolved_last_1h: 0,
          net_flow_1h: 0,
          sampled_at: '2026-11-14T00:00:00Z',
        },
        snapshots: [],
      }),
    }),
  );
  await page.route('**/admin/batch/run-history**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [] }),
    }),
  );
  await page.route('**/admin/memory/supersede-candidates?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [],
        pagination: {
          page: 1,
          page_size: 25,
          total_count: 0,
          total_pages: 0,
          has_prev: false,
          has_next: false,
        },
        filters_applied: {},
      }),
    }),
  );
}

type ClipReport = {
  clipped: Array<{ cls: string; right: number; wrapRight: number }>;
  multiLine: Array<{ cls: string; lines: number; width: number; text: string }>;
  englishHits: string[];
};

async function measureReviewTable(page: Page): Promise<ClipReport> {
  return page.evaluate(() => {
    const clipped: Array<{ cls: string; right: number; wrapRight: number }> = [];
    const multiLine: Array<{ cls: string; lines: number; width: number; text: string }> = [];
    const englishHits: string[] = [];
    const wrap = document.getElementById('rc-table-wrap');
    const table = document.getElementById('rc-table');
    if (!wrap || !table) {
      return { clipped, multiLine, englishHits: ['missing-table'] };
    }
    const wrapRight = wrap.getBoundingClientRect().right;
    const oneLineSels = ['.rc-cell-id', '.rc-cell-due', '.rc-cell-status', '.rc-cell-priority'];
    for (const td of Array.from(table.querySelectorAll('tbody td'))) {
      const box = td.getBoundingClientRect();
      if (box.right > wrapRight + 1) {
        clipped.push({
          cls: td.className || 'td',
          right: Math.round(box.right * 10) / 10,
          wrapRight: Math.round(wrapRight * 10) / 10,
        });
      }
      const matched = oneLineSels.find((sel) => td.matches(sel));
      if (!matched) {
        continue;
      }
      // Table row height follows the tallest cell (reason). Count text runs, not td box height.
      const range = document.createRange();
      range.selectNodeContents(td);
      const tops = new Set();
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0 && rect.height > 0) {
          tops.add(Math.round(rect.top));
        }
      }
      const lines = tops.size;
      if (lines > 1 || box.width < 1) {
        multiLine.push({
          cls: matched.slice(1),
          lines,
          width: Math.round(box.width * 10) / 10,
          text: (td.textContent || '').slice(0, 40),
        });
      }
    }
    const textBlob = (table.innerText || '') + (wrap.innerText || '');
    for (const token of ['pending', 'eligible:', 'Memory ID', 'Candidate ID', 'memory_review_candidates']) {
      if (textBlob.includes(token)) {
        englishHits.push(token);
      }
    }
    return { clipped, multiLine, englishHits };
  });
}

async function openReviewTab(page: Page): Promise<void> {
  const tab = page.locator('#dashboard-tab-review');
  if (!(await tab.isVisible())) {
    await page.locator('#dashboard-nav-toggle').click();
    await expect(tab).toBeVisible();
  }
  await tab.click();
  await expect(page.locator('#rc-table tbody tr')).toHaveCount(1, { timeout: 10_000 });
}

test.describe('review queue table wrap (#1722)', () => {
  for (const width of [390, 768, 1280, 1440, 1920] as const) {
    test(`table cells stay inside wrap at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await installReviewRoutes(page);
      await page.goto('/dashboard');
      await openReviewTab(page);

      await expect(page.locator('#rc-table thead')).toContainText('기억 ID');
      await expect(page.locator('#rc-table thead')).toContainText('후보 ID');
      await expect(page.locator('#rc-table tbody tr').first()).toContainText('대기');
      await expect(page.locator('#rc-table tbody tr').first()).toContainText('기준 이상');

      const report = await measureReviewTable(page);
      expect(report.clipped, `clipped: ${JSON.stringify(report.clipped)}`).toEqual([]);
      expect(report.englishHits, `english: ${JSON.stringify(report.englishHits)}`).toEqual([]);
      if (width === 1280) {
        expect(report.multiLine, `multi-line: ${JSON.stringify(report.multiLine)}`).toEqual([]);
      }
    });
  }

  test('expanded diagnostics and supersede stay inside layout at 1280', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await installReviewRoutes(page);
    await page.goto('/dashboard');
    await openReviewTab(page);
    await page.locator('#rc-diagnostics > summary').click();
    await page.locator('#rc-supersede-section > summary').click();
    await expect(page.locator('#rc-health-panel')).toBeVisible();
    await expect(page.locator('#rc-supersede-section')).toHaveAttribute('open', '');

    const overflow = await page.evaluate(() => {
      const layout = document.querySelector('.review-candidates-layout');
      if (!layout) {
        return { ok: false, reason: 'missing-layout' };
      }
      const box = layout.getBoundingClientRect();
      return {
        ok: box.right <= window.innerWidth + 1,
        right: Math.round(box.right),
        vw: window.innerWidth,
      };
    });
    expect(overflow.ok, `layout overflow: ${JSON.stringify(overflow)}`).toBe(true);

    const report = await measureReviewTable(page);
    expect(report.clipped).toEqual([]);
    expect(report.multiLine).toEqual([]);
  });
});
