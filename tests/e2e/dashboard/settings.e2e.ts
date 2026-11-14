import { expect, test, type Page } from '@playwright/test';

const SECRET = 'sk-e2e-should-never-render';

function setting(overrides: Record<string, unknown>) {
  return {
    key: 'SUPERSEDE_APPLY_ENABLED',
    description: '사람이 승인한 대체 후보를 적용하는 admin 경로를 켠다.',
    kind: 'boolean',
    allowed: ['true', 'false'],
    apply: 'immediate',
    risk: 'medium',
    value: 'false',
    source: 'default',
    default_value: 'false',
    default_source: 'shared/config/index.ts',
    env_value: null,
    override: null,
    pending_restart: false,
    last_change: null,
    ...overrides,
  };
}

async function installSettingsRoutes(page: Page, puts: Array<Record<string, unknown>>): Promise<void> {
  let overridden = false;
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
  await page.route('**/admin/settings/events**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: overridden
          ? [{
              id: 'e1', setting_key: 'SUPERSEDE_APPLY_ENABLED', action: 'set', previous_value: null, new_value: 'true',
              actor: 'session:abc', reason: 'e2e 사유', created_at: '2026-11-01T00:00:00.000Z',
            }]
          : [],
      }),
    }),
  );
  await page.route('**/admin/settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        settings: [
          overridden
            ? setting({
                value: 'true', source: 'override',
                override: { value: 'true', updated_at: '2026-11-01T00:00:00.000Z', updated_by: 'session:abc' },
                last_change: { action: 'set', actor: 'session:abc', reason: 'e2e 사유', created_at: '2026-11-01T00:00:00.000Z' },
              })
            : setting({}),
          setting({
            key: 'SEARCH_REJECTION_GATE_THRESHOLD',
            description: '검색 기각 게이트 임계값. 낮으면 더 많은 질의를 거부한다.',
            kind: 'number',
            allowed: null,
            risk: 'high',
            value: '0.35',
            default_value: '0.35',
            last_change: {
              action: 'set',
              actor: 'session:abc',
              reason: '임계 조정',
              created_at: '2026-11-14T05:00:00.000Z',
            },
          }),
        ],
        read_only: [
          { key: 'OPENAI_API_KEY', secret: true, set: true, value: null },
          { key: 'EMBEDDING_PROVIDER', secret: false, set: true, value: 'minilm' },
        ],
      }),
    }),
  );
  await page.route('**/admin/settings/SUPERSEDE_APPLY_ENABLED', (route) => {
    puts.push({ method: route.request().method(), body: route.request().postDataJSON() });
    overridden = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(setting({ value: 'true', source: 'override' })) });
  });
}

async function openSettingsTab(page: Page): Promise<void> {
  const tab = page.locator('#dashboard-tab-settings');
  if (!(await tab.isVisible())) {
    await page.locator('#dashboard-nav-toggle').click();
    await expect(tab).toBeVisible();
  }
  await tab.click();
  await expect(page.locator('#settings-tbody tr')).toHaveCount(2, { timeout: 10_000 });
}

async function measureSettingsTable(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector('#settings-table') as HTMLTableElement | null;
    if (!table) {
      return { ok: false as const };
    }
    const cols = Array.from(table.querySelectorAll('col')).map((c) => getComputedStyle(c).width);
    const thLines: Array<{ text: string; lines: number }> = [];
    for (const th of Array.from(table.querySelectorAll('thead th')) as HTMLElement[]) {
      const range = document.createRange();
      range.selectNodeContents(th);
      const rects = range.getClientRects();
      const tops = new Set(Array.from(rects).map((r) => Math.round(r.top)));
      if (tops.size > 1) {
        thLines.push({ text: (th.textContent || '').trim(), lines: tops.size });
      }
    }
    const keyClip: Array<{ scroll: number; client: number; lines: number }> = [];
    for (const key of Array.from(table.querySelectorAll('.settings-key')) as HTMLElement[]) {
      const range = document.createRange();
      range.selectNodeContents(key);
      const rects = range.getClientRects();
      const tops = new Set(Array.from(rects).map((r) => Math.round(r.top)));
      if (tops.size > 1 || key.scrollWidth > key.clientWidth + 1) {
        keyClip.push({
          scroll: key.scrollWidth,
          client: key.clientWidth,
          lines: tops.size,
        });
      }
    }
    return {
      ok: true as const,
      colCount: cols.length,
      equalCols: cols.length >= 2 && cols.every((w) => w === cols[0]),
      thLines,
      keyClip,
    };
  });
}

test.describe('Settings dashboard tab (#1583)', () => {
  test('changes a setting only after a reason, then offers revert, and never renders secrets', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    await installSettingsRoutes(page, puts);
    await page.goto('/dashboard');
    await openSettingsTab(page);

    const row = page.locator('#settings-tbody tr[data-key="SUPERSEDE_APPLY_ENABLED"]');
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: '되돌리기' })).toHaveCount(0);
    await expect(page.locator('#settings-readonly-list')).toContainText('minilm');
    await expect(page.locator('#tab-settings')).not.toContainText(SECRET);

    await row.getByLabel('SUPERSEDE_APPLY_ENABLED').selectOption('true');
    await row.getByRole('button', { name: '변경' }).click();
    await expect(page.locator('#settings-dialog')).toBeVisible();

    await page.locator('#settings-dialog-confirm').click();
    await expect(page.locator('#settings-dialog-error')).toBeVisible();
    expect(puts).toEqual([]);

    await page.locator('#settings-dialog-reason').fill('e2e 사유');
    await page.locator('#settings-dialog-confirm').click();
    await expect(page.locator('#settings-dialog')).toBeHidden();
    expect(puts).toEqual([{ method: 'PUT', body: { value: 'true', reason: 'e2e 사유' } }]);

    await expect(row.getByRole('button', { name: '되돌리기' })).toBeVisible();
    await expect(page.locator('#settings-events-tbody')).toContainText('e2e 사유');
    await page.screenshot({ path: test.info().outputPath('settings-tab.png'), fullPage: true });
  });

  for (const width of [390, 1280] as const) {
    test(`settings headers and keys stay one line at ${width}px (#1724)`, async ({ page }) => {
      const puts: Array<Record<string, unknown>> = [];
      await page.setViewportSize({ width, height: 900 });
      await installSettingsRoutes(page, puts);
      await page.goto('/dashboard');
      await openSettingsTab(page);

      await expect(page.locator('#settings-table thead')).toContainText('마지막 변경');
      const report = await measureSettingsTable(page);
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      expect(report.colCount).toBe(6);
      expect(report.equalCols, `equal cols (missing widths)`).toBe(false);
      expect(report.thLines, `header wrap: ${JSON.stringify(report.thLines)}`).toEqual([]);
      // keys may ellipsis (scroll>client) but must not glyph-wrap to multiple lines
      expect(
        report.keyClip.filter((k) => k.lines > 1),
        `key glyph wrap: ${JSON.stringify(report.keyClip)}`,
      ).toEqual([]);
    });
  }

  test('removing settings colgroup equalizes columns (counter-check)', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    await page.setViewportSize({ width: 1280, height: 900 });
    await installSettingsRoutes(page, puts);
    await page.goto('/dashboard');
    await openSettingsTab(page);

    const before = await measureSettingsTable(page);
    expect(before.ok && !before.equalCols).toBe(true);

    await page.evaluate(() => {
      document.querySelector('#settings-table colgroup')?.remove();
      const style = document.createElement('style');
      style.textContent = `
        #settings-table { table-layout: fixed; width: 100%; }
        .settings-key { overflow-wrap: anywhere !important; white-space: normal !important; }
      `;
      document.head.appendChild(style);
    });

    const after = await measureSettingsTable(page);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.colCount).toBe(0);
    // With anywhere wrap restored, long keys or headers may multi-line
    const broken =
      after.thLines.length > 0 || after.keyClip.some((k) => k.lines > 1) || after.equalCols;
    expect(broken, `revert should break layout: ${JSON.stringify(after)}`).toBe(true);
  });
});
