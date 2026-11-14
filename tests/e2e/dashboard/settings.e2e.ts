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
            default_value: '0.5',
            default_source: 'shared/config/constants.ts DEFAULT_MEMORY_INJECTION_THRESHOLD',
            inactive_reason: '상위 스위치가 꺼져 이 값을 읽지 않습니다.',
            last_change: {
              action: 'set',
              actor: 'session:abc',
              reason: '임계 조정',
              created_at: '2026-11-14T05:00:00.000Z',
            },
          }),
          setting({
            key: 'CLUSTER_JUDGE_MODE',
            description: '군집 판정 모드.',
            kind: 'string',
            allowed: ['off', 'on'],
            risk: 'low',
            value: 'off',
            source: 'env',
            default_value: 'off',
            default_source: 'shared/config/environment.ts ENV_DEFAULTS isClusterJudgeEnabled',
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
  await expect(page.locator('#settings-tbody tr')).toHaveCount(3, { timeout: 10_000 });
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
    const keyClip: Array<{ scroll: number; client: number; lines: number; text: string }> = [];
    const keyTruncated: Array<{ text: string; scroll: number; client: number }> = [];
    for (const key of Array.from(table.querySelectorAll('.settings-key')) as HTMLElement[]) {
      const range = document.createRange();
      range.selectNodeContents(key);
      const rects = range.getClientRects();
      const tops = new Set(Array.from(rects).map((r) => Math.round(r.top)));
      const text = (key.textContent || '').trim();
      if (tops.size > 1 || key.scrollWidth > key.clientWidth + 1) {
        keyClip.push({
          scroll: key.scrollWidth,
          client: key.clientWidth,
          lines: tops.size,
          text: text.slice(0, 40),
        });
      }
      // Ellipsis / overflow clip (390 must not do this — full key on its own line)
      if (key.scrollWidth > key.clientWidth + 1) {
        keyTruncated.push({ text: text.slice(0, 40), scroll: key.scrollWidth, client: key.clientWidth });
      }
    }

    const defaultOverlap: Array<{ key: string; defaultRight: number; nextLeft: number }> = [];
    const pathInCell: string[] = [];
    const missingSource: string[] = [];
    for (const row of Array.from(table.querySelectorAll('tbody tr')) as HTMLTableRowElement[]) {
      const key = row.dataset.key || '';
      const cells = row.querySelectorAll('td');
      const def = cells[2] as HTMLElement | undefined;
      const next = cells[3] as HTMLElement | undefined;
      if (!def || !next) continue;
      const dr = def.getBoundingClientRect();
      const nr = next.getBoundingClientRect();
      if (dr.right > nr.left + 1) {
        defaultOverlap.push({
          key,
          defaultRight: Math.round(dr.right),
          nextLeft: Math.round(nr.left),
        });
      }
      const visible = (def.innerText || '').replace(/\s+/g, ' ');
      if (visible.includes('shared/config')) {
        pathInCell.push(key + ':' + visible.slice(0, 80));
      }
      if (!def.querySelector('.settings-default__source')) {
        missingSource.push(key);
      }
    }

    const btnLines: Array<{ text: string; lines: number; w: number }> = [];
    for (const btn of Array.from(table.querySelectorAll('.settings-btn')) as HTMLElement[]) {
      const range = document.createRange();
      range.selectNodeContents(btn);
      const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      if (tops.size > 1) {
        btnLines.push({
          text: (btn.textContent || '').trim(),
          lines: tops.size,
          w: Math.round(btn.getBoundingClientRect().width),
        });
      }
    }

    const badgeLines: Array<{ text: string; lines: number; w: number }> = [];
    const emptyBadges: Array<{ w: number; h: number; cls: string }> = [];
    for (const badge of Array.from(table.querySelectorAll('.m-badge')) as HTMLElement[]) {
      const text = (badge.textContent || '').trim();
      const box = badge.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(badge);
      const tops = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
      if (tops.size > 1) {
        badgeLines.push({
          text,
          lines: tops.size,
          w: Math.round(box.width),
        });
      }
      if (!text || box.width < 8) {
        emptyBadges.push({ w: Math.round(box.width), h: Math.round(box.height), cls: badge.className });
      }
    }

    const sourceLabels = Array.from(table.querySelectorAll('.m-badge')).map((b) =>
      (b.textContent || '').trim(),
    );
    const stackedPhone =
      window.innerWidth <= 480 &&
      Array.from(table.querySelectorAll('tbody td')).some(
        (td) => getComputedStyle(td).flexDirection === 'column',
      );

    return {
      ok: true as const,
      colCount: cols.length,
      equalCols: cols.length >= 2 && cols.every((w) => w === cols[0]),
      thLines,
      keyClip,
      keyTruncated,
      defaultOverlap,
      pathInCell,
      missingSource,
      btnLines,
      badgeLines,
      emptyBadges,
      sourceLabels,
      stackedPhone,
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

  for (const width of [390, 768, 1280] as const) {
    test(`settings cells stay readable at ${width}px (#1724 r2)`, async ({ page }) => {
      const puts: Array<Record<string, unknown>> = [];
      await page.setViewportSize({ width, height: 900 });
      await installSettingsRoutes(page, puts);
      await page.goto('/dashboard');
      await openSettingsTab(page);

      await expect(page.locator('#settings-table thead')).toContainText('마지막 변경');
      await expect(page.locator('#settings-tbody .settings-default__source').first()).toContainText('코드');
      await expect(page.locator('#settings-tbody')).toContainText('환경 기본값');
      await expect(page.locator('#settings-tbody')).toContainText('상수 기본값');
      await expect(page.locator('#settings-tbody')).toContainText('환경 파일 값');
      await expect(page.locator('#settings-tbody')).not.toContainText('.ENV');
      await expect(page.locator('#settings-tbody')).not.toContainText('.env');

      const report = await measureSettingsTable(page);
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      expect(report.colCount).toBe(6);
      expect(report.equalCols, `equal cols (missing widths)`).toBe(false);
      expect(report.thLines, `header wrap: ${JSON.stringify(report.thLines)}`).toEqual([]);
      expect(report.pathInCell, `path in cell: ${JSON.stringify(report.pathInCell)}`).toEqual([]);
      expect(report.missingSource, `missing source node: ${JSON.stringify(report.missingSource)}`).toEqual([]);
      expect(report.btnLines, `btn wrap: ${JSON.stringify(report.btnLines)}`).toEqual([]);
      expect(report.badgeLines, `badge wrap: ${JSON.stringify(report.badgeLines)}`).toEqual([]);
      expect(report.emptyBadges, `empty badge: ${JSON.stringify(report.emptyBadges)}`).toEqual([]);
      if (width === 390) {
        // Stacked cards: side-by-side overlap metric does not apply
        expect(report.stackedPhone, '390 settings cells must stack full-width').toBe(true);
        expect(report.keyTruncated, `390 key truncate: ${JSON.stringify(report.keyTruncated)}`).toEqual([]);
        await expect(page.locator('#settings-tbody')).toContainText('SEARCH_REJECTION_GATE_THRESHOLD');
        await expect(page.locator('#settings-tbody')).toContainText('CLUSTER_JUDGE_MODE');
        await expect(page.locator('#settings-tbody .settings-inactive-reason').first()).toBeVisible();
        await expect(page.locator('#settings-tbody .settings-default__source').first()).toBeVisible();
      } else {
        expect(report.defaultOverlap, `default overlap: ${JSON.stringify(report.defaultOverlap)}`).toEqual([]);
        expect(
          report.keyClip.filter((k) => k.lines > 1),
          `key glyph wrap: ${JSON.stringify(report.keyClip)}`,
        ).toEqual([]);
      }
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
    const broken =
      after.thLines.length > 0 || after.keyClip.some((k) => k.lines > 1) || after.equalCols;
    expect(broken, `revert should break layout: ${JSON.stringify(after)}`).toBe(true);
  });

  test('reverting defaultCell to path concat overflows and exposes shared/config (counter-check)', async ({
    page,
  }) => {
    const puts: Array<Record<string, unknown>> = [];
    await page.setViewportSize({ width: 1280, height: 900 });
    await installSettingsRoutes(page, puts);
    await page.goto('/dashboard');
    await openSettingsTab(page);

    const before = await measureSettingsTable(page);
    expect(before.ok && before.defaultOverlap.length === 0 && before.pathInCell.length === 0).toBe(true);

    await page.evaluate(() => {
      const ns = (window as unknown as {
        __MEMENTO_SETTINGS_PANEL__: {
          state: { settings: Array<Record<string, unknown>> };
          formatValue: (v: unknown) => string;
          el: (tag: string, cls?: string, text?: string) => HTMLElement;
          clearNode: (n: HTMLElement | null) => void;
          $: (id: string) => HTMLElement | null;
          renderSettings: () => void;
        };
      }).__MEMENTO_SETTINGS_PANEL__;
      ns.renderSettings = function () {
        const tbody = ns.$('settings-tbody');
        ns.clearNode(tbody);
        ns.state.settings.forEach(function (setting) {
          const row = document.createElement('tr');
          row.dataset.key = String(setting.key || '');
          for (let i = 0; i < 6; i++) {
            const td = document.createElement('td');
            if (i === 2) {
              td.textContent =
                ns.formatValue(setting.default_value) + ' (' + String(setting.default_source || '') + ')';
            } else if (i === 0) {
              const key = document.createElement('code');
              key.className = 'm-code-inline settings-key';
              key.textContent = String(setting.key || '');
              td.appendChild(key);
            } else {
              td.textContent = i === 5 ? '변경' : 'x';
            }
            row.appendChild(td);
          }
          tbody?.appendChild(row);
        });
      };
      const style = document.createElement('style');
      style.textContent = `
        .settings-col-default { width: 6.5rem !important; }
        .settings-default, .settings-default__value, .settings-default__source { all: unset; }
      `;
      document.head.appendChild(style);
      ns.renderSettings();
    });

    const after = await measureSettingsTable(page);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const broken =
      after.pathInCell.length > 0 ||
      after.defaultOverlap.length > 0 ||
      after.missingSource.length > 0;
    expect(broken, `concat revert should fail gate: ${JSON.stringify(after)}`).toBe(true);
  });
});
