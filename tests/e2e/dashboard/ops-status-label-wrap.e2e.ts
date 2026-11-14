import { expect, test, type Page } from '@playwright/test';

// #1716: ops-row cells stay inside the card; no glyph wrap. Measure clip + one-line at 1280.

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
      key: 'llm_supersede_judge_other_failures',
      value: 1200,
      unit: 'count',
      severity: null,
      as_of: null,
      window: { period: '7d' },
    },
    {
      key: 'llm_agent_chat_rate_limited',
      value: 44,
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
      key: 'review_last_human_decision_at',
      value: LONG_BACKUP,
      unit: null,
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

type ClipReport = {
  clipped: Array<{ key: string; cls: string; right: number; cardRight: number }>;
  multiLine: Array<{ key: string; cls: string; lines: number; width: number }>;
};

async function measureOpsRows(page: Page): Promise<ClipReport> {
  return page.evaluate(() => {
    const clipped: Array<{ key: string; cls: string; right: number; cardRight: number }> = [];
    const multiLine: Array<{ key: string; cls: string; lines: number; width: number }> = [];
    const clipParts = ['.ops-row__label', '.ops-row__value', '.ops-row__window', '.ops-row__link'];
    // Buttons: clip only. Border + line-height:normal estimate false-positives multiLine on CI fonts.
    const lineParts = ['.ops-row__label', '.ops-row__value', '.ops-row__window'];
    for (const row of Array.from(document.querySelectorAll('.ops-row'))) {
      const card = row.closest('.ops-status-card');
      if (!card) {
        continue;
      }
      const cardRight = card.getBoundingClientRect().right;
      const key = row.getAttribute('data-key') || '';
      for (const sel of clipParts) {
        const el = row.querySelector(sel);
        if (!el) {
          continue;
        }
        const box = el.getBoundingClientRect();
        if (box.right > cardRight + 1) {
          clipped.push({
            key,
            cls: sel.slice(1),
            right: Math.round(box.right * 10) / 10,
            cardRight: Math.round(cardRight * 10) / 10,
          });
        }
      }
      for (const sel of lineParts) {
        const el = row.querySelector(sel);
        if (!el) {
          continue;
        }
        const box = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const fontSize = parseFloat(cs.fontSize) || 14;
        const lineHeightRaw = cs.lineHeight;
        const lineHeight =
          lineHeightRaw === 'normal' ? fontSize * 1.2 : parseFloat(lineHeightRaw) || fontSize * 1.2;
        const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        const lines = Math.max(0, box.height - padY) / lineHeight;
        if (lines > 1.15 || box.width < 1) {
          multiLine.push({
            key,
            cls: sel.slice(1),
            lines: Math.round(lines * 100) / 100,
            width: Math.round(box.width * 10) / 10,
          });
        }
      }
    }
    return { clipped, multiLine };
  });
}

test.describe('ops-status label wrap (#1716)', () => {
  for (const width of [390, 1280, 1440] as const) {
    test(`ops-row cells stay inside cards at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await installOpsStatusRoutes(page);
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: '정상인가' })).toBeVisible();
      await expect(page.locator('.ops-row[data-key="review_pending_total"]')).toHaveCount(1);
      await expect(page.locator('.ops-row[data-key="llm_supersede_judge_other_failures"]')).toHaveCount(1);

      const report = await measureOpsRows(page);
      expect(report.clipped, `clipped: ${JSON.stringify(report.clipped)}`).toEqual([]);
      if (width === 1280) {
        expect(report.multiLine, `multi-line: ${JSON.stringify(report.multiLine)}`).toEqual([]);
      }
    });
  }
});
