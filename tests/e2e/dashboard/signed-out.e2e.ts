import { expect, test } from '@playwright/test';

// #1703: signed-out dashboard shows login chrome only — no tabs, panels, or phone nav toggle.
async function gotoSignedOut(page: import('@playwright/test').Page) {
  await page.route('**/auth/**', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.route('**/admin/**', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.route('**/api/**', (route) => route.fulfill({ status: 401, body: '{}' }));
  await page.goto('/dashboard');
  await expect(page.locator('.dashboard-container')).toHaveAttribute('data-auth-state', 'signed-out');
}

test.describe('dashboard signed-out chrome (#1703)', () => {
  test('desktop: zero visible tabs/panels, login form visible, nav toggle hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoSignedOut(page);

    await expect(page.locator('#dashboard-auth-form')).toBeVisible();
    await expect(page.locator('#dashboard-auth-message')).toBeVisible();
    await expect(page.locator('.m-tab-btn')).toHaveCount(10);
    await expect(page.locator('.m-tab-btn').filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('.tab-panel').filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('#dashboard-nav-toggle')).toBeHidden();
  });

  test('phone 390px: nav toggle stays hidden with no tabs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSignedOut(page);

    await expect(page.locator('#dashboard-auth-form')).toBeVisible();
    await expect(page.locator('#dashboard-nav-toggle')).toBeHidden();
    await expect(page.locator('.m-tab-btn').filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('.tab-panel').filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('.m-nav-chip').filter({ visible: true })).toHaveCount(0);
  });
});
