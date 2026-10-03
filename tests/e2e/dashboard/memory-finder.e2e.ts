import { expect, test, type Page } from '@playwright/test';

const MEM_E2E_PAYLOAD = {
  message: 'Memory item',
  memory: {
    id: 'mem_e2e',
    type: 'semantic',
    content: 'e2e body',
    importance: 0.5,
    privacy_scope: 'private',
    pinned: false,
    created_at: '2026-10-01T00:00:00Z',
    last_accessed: null,
    last_accessed_at: null,
    tags: null,
    source: null,
    project_id: null,
    owner_id: null,
  },
};

async function installMemoryFinderRoutes(page: Page): Promise<void> {
  // Order matters — later routes win in Playwright.
  await page.route('**/admin/**', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Memory not found' }),
    }),
  );
  await page.route('**/api/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    }),
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
  await page.route('**/admin/memory/items/mem_e2e', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MEM_E2E_PAYLOAD),
    }),
  );
}

test.describe('Memory finder dashboard (#1118)', () => {
  test.beforeEach(async ({ page }) => {
    await installMemoryFinderRoutes(page);
  });

  test('deep link opens memory finder tab and loads memory by ID', async ({ page }) => {
    await page.goto('/dashboard?memory_id=mem_e2e');

    await expect(page.locator('#dashboard-tab-memory-finder')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-memory-finder')).toBeVisible();
    await expect(page.locator('#mf-id-input')).toHaveValue('mem_e2e');
    await expect(page.locator('#mf-detail')).toBeVisible();
    await expect(page.locator('#mf-d-content')).toHaveText('e2e body');
    await expect(page.locator('#mf-d-pinned')).toHaveText('아니오');
    await expect(page.locator('#mf-empty')).toBeHidden();
  });

  test('default tab stays anchor when no memory_id deep link', async ({ page }) => {
    await page.goto('/dashboard');

    await expect(page.locator('#dashboard-tab-anchor')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-memory-finder')).toBeHidden();
  });

  test('opens memory by ID then shows 404 status for missing ID', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('#dashboard-tab-memory-finder').click();

    await expect(page.locator('#mf-empty')).toBeVisible();
    await page.locator('#mf-id-input').fill('mem_e2e');
    await page.locator('#mf-id-open').click();

    await expect(page.locator('#mf-d-content')).toHaveText('e2e body');
    await expect(page.locator('#mf-d-content')).toBeVisible();

    await page.locator('#mf-id-input').fill('mem_missing');
    await page.locator('#mf-id-input').press('Enter');

    await expect(page.locator('#mf-status')).toHaveText('해당 Memory ID 의 기억이 없습니다');
    await expect(page.locator('#mf-detail')).toBeHidden();
  });
});
