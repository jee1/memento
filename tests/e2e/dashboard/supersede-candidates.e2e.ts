import { expect, test, type Page } from '@playwright/test';

const OLD_CONTENT = '옛 기억 '.repeat(60) + '\n마지막 조건 <img src=x onerror=window.__sc_xss=1>';
const NEW_CONTENT = '새 기억 '.repeat(60) + '\n최종 지시';

async function installRoutes(page: Page, applyEnabled = false, missingBody = false): Promise<void> {
  // 세션 probe(/api/anchors/map)가 200 이어야 session-only 탭이 보인다.
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
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
              old_content_preview: OLD_CONTENT.slice(0, 200),
              new_content_preview: NEW_CONTENT.slice(0, 200),
              rationale: '근거',
              provider: 'gemini',
              model: 'm',
              judged_at: '2026-11-01T00:00:00.000Z',
              dismissed_at: null,
              supersede_apply_enabled: applyEnabled,
            },
          ],
          pagination: { page: 1, page_size: 25, total_count: 1, total_pages: 1, has_prev: false, has_next: false },
          filters_applied: { verdict: ['confirmed', 'pending'] },
        }),
      });
    }
    if (url.endsWith('/admin/memory/items/old') || url.endsWith('/admin/memory/items/new')) {
      if (missingBody && url.endsWith('/old')) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Memory not found"}' });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        memory: { content: url.endsWith('/old') ? OLD_CONTENT : NEW_CONTENT },
      }) });
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

  test('shows the full old/new bodies before enabling approval', async ({ page }) => {
    await installRoutes(page, true);
    await page.goto('/static/dashboard.html');
    await page.click('#dashboard-tab-supersede');
    const bodies = page.locator('#sc-detail .sc-preview');
    await expect(bodies.nth(0)).toHaveText(OLD_CONTENT);
    await expect(bodies.nth(1)).toHaveText(NEW_CONTENT);
    await expect(page.locator('#sc-detail .sc-btn-apply')).toBeEnabled();
    await expect(page.locator('#sc-detail img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { __sc_xss?: number }).__sc_xss)).toBeUndefined();
  });

  test('explains a missing body and blocks approval', async ({ page }) => {
    await installRoutes(page, true, true);
    await page.goto('/static/dashboard.html');
    await page.click('#dashboard-tab-supersede');
    await expect(page.locator('#sc-detail .sc-content-status')).toContainText('전체 본문을 불러오지 못해 승인할 수 없습니다');
    await expect(page.locator('#sc-detail .sc-btn-apply')).toBeDisabled();
  });
});
