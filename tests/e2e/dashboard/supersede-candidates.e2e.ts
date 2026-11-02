import { expect, test, type Page } from '@playwright/test';

async function installRoutes(page: Page): Promise<void> {
  await page.route('**/admin/**', (route) => {
    const url = route.request().url();
    if (url.includes('/admin/memory/supersede-candidates?') && route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          candidates: [
            {
              id: 'c1',
              verdict: 'confirmed',
              lifecycle_status: 'not_applied',
              project_id: null,
              memory_type: 'semantic',
              old_memory_id: 'old',
              new_memory_id: 'new',
              old_content_preview: '옛 본문',
              new_content_preview: '새 본문',
              rationale: '근거',
              provider: 'gemini',
              model: 'm',
              judged_at: '2026-11-01T00:00:00.000Z',
              dismissed_at: null,
              supersede_apply_enabled: false,
            },
          ],
          pagination: { page: 1, page_size: 25, total_count: 1, total_pages: 1, has_prev: false, has_next: false },
          filters_applied: { verdict: ['confirmed', 'pending'] },
        }),
      });
    }
    if (url.endsWith('/admin/memory/supersede-candidates/c1/apply') && route.request().method() === 'POST') {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'SUPERSEDE_APPLY_DISABLED' }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/static/vendor/d3.v7.min.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  await page.route('**/graph**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
}

test.describe('Supersede candidates dashboard (#1618)', () => {
  test('disables apply with a visible hint when SUPERSEDE_APPLY_ENABLED is off', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/static/dashboard.html');
    await page.click('#dashboard-tab-supersede');
    await expect(page.locator('#sc-detail .sc-apply-hint')).toContainText('SUPERSEDE_APPLY_ENABLED');
    await expect(page.locator('#sc-detail .sc-btn-apply')).toBeDisabled();
  });
});
