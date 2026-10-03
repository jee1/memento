import { expect, test } from '@playwright/test';

// #1147: 390px phone layout contract. Every tab is reachable from the menu button, no page-level
// horizontal scroll, and every visible interactive control is at least 44px.
const TABS = [
  'anchor',
  'embedding',
  'graph',
  'ops-overview',
  'ops-status',
  'review',
  'memory-finder',
  'jobs',
  'agent-sessions',
  'evolution-demo',
];

test.describe('dashboard narrow layout (#1147)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.route('**/auth/**', (route) => route.fulfill({ status: 401, body: '{}' }));
    await page.route('**/admin/**', (route) => route.fulfill({ status: 401, body: '{}' }));
    await page.route('**/api/**', (route) => route.fulfill({ status: 401, body: '{}' }));
    await page.route('**/graph**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }));
    await page.goto('/dashboard');
    await page.evaluate(() => {
      document.querySelector('.dashboard-container')?.setAttribute('data-auth-state', 'signed-in');
    });
  });

  test('every tab is reachable from the menu, without horizontal scroll or sub-44px targets', async ({ page }) => {
    const toggle = page.locator('#dashboard-nav-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.locator('#dashboard-tablist')).toBeHidden();

    for (const tab of TABS) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const btn = page.locator(`.m-tab-btn[data-tab="${tab}"]`);
      await expect(btn).toBeVisible();
      await btn.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(btn).toHaveAttribute('aria-selected', 'true');
      await expect(toggle).toBeFocused();

      const report = await page.evaluate(() => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        };
        const small = Array.from(
          document.querySelectorAll('button, a[href], select, input:not([type=hidden]), summary, textarea, [role=tab]'),
        )
          .filter(visible)
          .map((el) => {
            const target =
              el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
                ? (el.closest('label, .rc-cell-select') ?? el)
                : el;
            const r = target.getBoundingClientRect();
            return { id: el.id || el.className, w: Math.round(r.width), h: Math.round(r.height) };
          })
          .filter((x) => x.w < 44 || x.h < 44);
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          small,
        };
      });
      expect(report.overflow, `${tab}: page scrolls horizontally`).toBe(0);
      expect(report.small, `${tab}: targets under 44px`).toEqual([]);
    }
  });

  test('group chips jump to the first tab of their group and mark the current group', async ({ page }) => {
    await page.locator('.m-nav-chip[data-nav-group="ops"]').click();
    await expect(page.locator('.m-tab-btn[data-tab="ops-overview"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.m-nav-chip[data-nav-group="ops"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.m-nav-chip[data-nav-group="spatial"]')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#dashboard-nav-toggle').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#dashboard-nav-toggle')).toHaveAttribute('aria-expanded', 'false');
  });
});
