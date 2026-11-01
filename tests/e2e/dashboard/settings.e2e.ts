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

test.describe('Settings dashboard tab (#1583)', () => {
  test('changes a setting only after a reason, then offers revert, and never renders secrets', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    await installSettingsRoutes(page, puts);
    await page.goto('/dashboard');
    await page.locator('#dashboard-tab-settings').click();

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
});
