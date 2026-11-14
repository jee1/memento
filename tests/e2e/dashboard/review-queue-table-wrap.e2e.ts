import { expect, test, type Page } from '@playwright/test';

// #1722: review-queue table cells stay inside the card; no glyph wrap; due/status not ellipsis-clipped.
// Measure text runs (not shared row height). Border omitted from line estimate (#1717).

const LONG_MEM = 'mem_1762772305abcdef0123456789deadbeef';
const LONG_CAND = '7dd21418-fd47-4a2b-9c1d-abcdef012345';
const ELIGIBLE =
  'eligible: importance=1.000>=0.4, stale=20d>=14d, anchor=last_recalled_at';

const CANDIDATES = [
  {
    id: LONG_CAND,
    memory_id: LONG_MEM,
    priority: 1300,
    status: 'pending',
    reason: ELIGIBLE,
    due_at: '2026-11-01T12:40:38.000Z',
  },
  {
    id: '11111111-2222-3333-4444-555555555555',
    memory_id: 'mem_1790000000abcdef',
    priority: 900,
    status: 'reviewed',
    reason: 'eligible: importance=0.350>=0.4, stale=45d>=14d, anchor=created_at_fallback',
    due_at: new Date(Date.now() + 17 * 86400000).toISOString(),
  },
  {
    id: '22222222-2222-3333-4444-555555555555',
    memory_id: 'mem_short',
    priority: 100,
    status: 'dismissed',
    reason: 'manual: some legacy reason text that is long enough',
    due_at: new Date().toISOString(),
  },
  {
    id: '33333333-2222-3333-4444-555555555555',
    memory_id: 'mem_1790000000zzzz',
    priority: 50,
    status: 'expired',
    reason: ELIGIBLE,
    due_at: 'not-a-date',
  },
];

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
        candidates: CANDIDATES,
        pagination: {
          page: 1,
          page_size: 25,
          total_count: CANDIDATES.length,
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
          pendingTotal: CANDIDATES.length,
          window1h: { candidatesCreated: 0, processedTotal: 1, netFlow: 0 },
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

type CellReport = {
  clipped: Array<{ cls: string; right: number; wrapRight: number }>;
  multiLine: Array<{ cls: string; lines: number; width: number; text: string }>;
  ellipsisClip: Array<{ cls: string; scroll: number; client: number; text: string }>;
  reasonNarrow: Array<{ width: number; text: string }>;
  englishHits: string[];
  equalColWidths: boolean;
  colWidths: number[];
};

async function measureReviewTable(page: Page): Promise<CellReport> {
  return page.evaluate(() => {
    const empty: CellReport = {
      clipped: [],
      multiLine: [],
      ellipsisClip: [],
      reasonNarrow: [],
      englishHits: ['missing-table'],
      equalColWidths: false,
      colWidths: [],
    };
    const wrap = document.getElementById('rc-table-wrap');
    const table = document.getElementById('rc-table');
    if (!wrap || !table) {
      return empty;
    }

    function countTextLines(td: HTMLElement): number {
      const range = document.createRange();
      range.selectNodeContents(td);
      const tops = new Set<number>();
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width > 0 && rect.height > 0) {
          tops.add(Math.round(rect.top));
        }
      }
      return tops.size;
    }

    function collectColWidths(row: Element | null): number[] {
      if (!row) {
        return [];
      }
      return Array.from(row.children).map((td) =>
        Math.round((td as HTMLElement).getBoundingClientRect().width),
      );
    }

    function isEqualColLayout(tableEl: HTMLElement, row: Element | null, widths: number[]): boolean {
      if (widths.length < 6 || Math.max(...widths) - Math.min(...widths) >= 8) {
        return false;
      }
      // card layout at 390 stacks cells full-width — skip equal-col check there
      if (getComputedStyle(tableEl).display === 'block') {
        return false;
      }
      return !(row && getComputedStyle(row as HTMLElement).display === 'block');
    }

    function inspectCells(
      tableEl: HTMLElement,
      limitRight: number,
    ): Pick<CellReport, 'clipped' | 'multiLine' | 'ellipsisClip' | 'reasonNarrow'> {
      const clipped: CellReport['clipped'] = [];
      const multiLine: CellReport['multiLine'] = [];
      const ellipsisClip: CellReport['ellipsisClip'] = [];
      const reasonNarrow: CellReport['reasonNarrow'] = [];
      const oneLineSels = ['.rc-cell-id', '.rc-cell-due', '.rc-cell-status', '.rc-cell-priority'];
      const noEllipsisSels = ['.rc-cell-due', '.rc-cell-status'];
      for (const td of Array.from(tableEl.querySelectorAll('tbody td')) as HTMLElement[]) {
        const box = td.getBoundingClientRect();
        if (box.right > limitRight + 1) {
          clipped.push({
            cls: td.className || 'td',
            right: Math.round(box.right * 10) / 10,
            wrapRight: Math.round(limitRight * 10) / 10,
          });
        }
        const matched = oneLineSels.find((sel) => td.matches(sel));
        if (matched) {
          const lines = countTextLines(td);
          if (lines > 1 || box.width < 1) {
            multiLine.push({
              cls: matched.slice(1),
              lines,
              width: Math.round(box.width * 10) / 10,
              text: (td.textContent || '').slice(0, 40),
            });
          }
        }
        if (noEllipsisSels.some((sel) => td.matches(sel)) && td.scrollWidth > td.clientWidth + 1) {
          ellipsisClip.push({
            cls: td.className,
            scroll: td.scrollWidth,
            client: td.clientWidth,
            text: (td.textContent || '').slice(0, 40),
          });
        }
        // ~10 Korean glyphs at 12–14px ≈ 120px; card layout is wider.
        if (td.matches('.rc-cell-reason') && box.width > 0 && box.width < 120) {
          reasonNarrow.push({
            width: Math.round(box.width * 10) / 10,
            text: (td.textContent || '').slice(0, 40),
          });
        }
      }
      return { clipped, multiLine, ellipsisClip, reasonNarrow };
    }

    const wrapRight = wrap.getBoundingClientRect().right;
    const card = wrap.closest('.review-candidates-layout') || wrap;
    const limitRight = Math.max(wrapRight, card.getBoundingClientRect().right);
    const firstRow = table.querySelector('tbody tr');
    const colWidths = collectColWidths(firstRow);
    const cellReport = inspectCells(table, limitRight);
    const textBlob = (table.innerText || '') + (wrap.innerText || '');
    const englishHits = [
      'pending',
      'eligible:',
      'Memory ID',
      'Candidate ID',
      'memory_review_candidates',
    ].filter((token) => textBlob.includes(token));

    return {
      ...cellReport,
      englishHits,
      equalColWidths: isEqualColLayout(table, firstRow, colWidths),
      colWidths,
    };
  });
}

async function openReviewTab(page: Page): Promise<void> {
  const tab = page.locator('#dashboard-tab-review');
  if (!(await tab.isVisible())) {
    await page.locator('#dashboard-nav-toggle').click();
    await expect(tab).toBeVisible();
  }
  await tab.click();
  await expect(page.locator('#rc-table tbody tr')).toHaveCount(CANDIDATES.length, {
    timeout: 10_000,
  });
}

test.describe('review queue table wrap (#1722)', () => {
  for (const width of [390, 768, 1280, 1440, 1920] as const) {
    test(`table cells stay readable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await installReviewRoutes(page);
      await page.goto('/dashboard');
      await openReviewTab(page);

      await expect(page.locator('#rc-table thead')).toContainText('기억 ID');
      await expect(page.locator('#rc-table thead')).not.toContainText('후보 ID');
      await expect(page.locator('#rc-table tbody')).toContainText('대기');
      await expect(page.locator('#rc-table tbody')).toContainText('기준 이상');

      const report = await measureReviewTable(page);
      expect(report.clipped, `clipped: ${JSON.stringify(report.clipped)}`).toEqual([]);
      expect(report.englishHits, `english: ${JSON.stringify(report.englishHits)}`).toEqual([]);
      expect(
        report.equalColWidths,
        `equal col widths (dead th width): ${JSON.stringify(report.colWidths)}`,
      ).toBe(false);
      if (width === 390 || width === 1280) {
        expect(report.multiLine, `multi-line: ${JSON.stringify(report.multiLine)}`).toEqual([]);
        expect(
          report.ellipsisClip,
          `due/status ellipsis: ${JSON.stringify(report.ellipsisClip)}`,
        ).toEqual([]);
        expect(
          report.reasonNarrow,
          `reason too narrow: ${JSON.stringify(report.reasonNarrow)}`,
        ).toEqual([]);
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
    expect(report.ellipsisClip).toEqual([]);
    expect(report.reasonNarrow).toEqual([]);
    expect(report.equalColWidths).toBe(false);
  });
});
