import { expect, test, type Page } from '@playwright/test';

// #1725: ops-status (and sibling tab layouts) must scroll under a short viewport.
// Fail if the last .ops-row stays below the fold after wheel/End. Do not use scrollIntoView.

const LONG = '2026-11-13T11:33:16.000Z';

function manyRows(prefix: string, n: number, severity: string | null) {
  return Array.from({ length: n }, (_, i) => ({
    key: `${prefix}_${i}`,
    value: i === 0 ? LONG : i * 17,
    unit: i === 0 ? null : 'count',
    severity,
    as_of: null,
    window: { period: '7d' as const },
  }));
}

const ZONES = {
  system_ok: manyRows('ok', 10, 'ok'),
  doing_work: manyRows('work', 10, null),
  needs_action: manyRows('need', 10, 'warn'),
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

async function wheelAndEndToBottom(page: Page, layoutSelector: string): Promise<void> {
  const layout = page.locator(layoutSelector);
  await expect(layout).toBeVisible();
  const box = await layout.boundingBox();
  expect(box, 'layout bounding box').toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(80, box!.height / 3));
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, 600);
  }
  await layout.evaluate((el: HTMLElement) => {
    el.tabIndex = -1;
    el.focus();
  });
  await page.keyboard.press('End');
}

async function assertLastOpsRowInViewport(page: Page): Promise<void> {
  const last = page.locator('.ops-row').last();
  await expect(last).toBeVisible();
  const report = await last.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      vh: window.innerHeight,
      inView: r.top >= -1 && r.bottom <= window.innerHeight + 1,
    };
  });
  expect(report, `last ops-row not in viewport: ${JSON.stringify(report)}`).toMatchObject({
    inView: true,
  });
}

async function assertLayoutScrollsWithTallChild(page: Page, tab: string, layoutClass: string): Promise<void> {
  await page.locator(`.m-tab-btn[data-tab="${tab}"]`).click();
  const layout = page.locator(`.${layoutClass}`);
  await expect(layout).toBeVisible();
  const canScroll = await layout.evaluate((el: HTMLElement) => {
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'height:3000px;flex-shrink:0;';
    el.appendChild(sentinel);
    el.scrollTop = 0;
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    const after = el.scrollTop;
    sentinel.remove();
    el.scrollTop = 0;
    return after - before > 100;
  });
  expect(canScroll, `${layoutClass} must become a scroll container`).toBe(true);
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const) {
  test.describe(`ops-status scroll (#1725) ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('wheel/End brings the last ops-row into the viewport', async ({ page }) => {
      await installOpsStatusRoutes(page);
      await page.goto('/dashboard');
      await expect(page.locator('.ops-row').first()).toBeVisible();
      await expect(page.locator('.ops-row').last()).toBeVisible();

      const before = await page.locator('.ops-row').last().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { bottom: Math.round(r.bottom), vh: window.innerHeight };
      });
      expect(before.bottom, 'fixture must overflow the viewport').toBeGreaterThan(before.vh);

      await wheelAndEndToBottom(page, '.ops-status-layout');
      await assertLastOpsRowInViewport(page);
    });
  });
}

test.describe('dashboard tab layout scroll (#1725)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('jobs and memory-finder layouts scroll when content overflows', async ({ page }) => {
    await installOpsStatusRoutes(page);
    await page.goto('/dashboard');
    await assertLayoutScrollsWithTallChild(page, 'jobs', 'jobs-layout');
    await assertLayoutScrollsWithTallChild(page, 'memory-finder', 'memory-finder-layout');
    await assertLayoutScrollsWithTallChild(page, 'review', 'review-candidates-layout');
    await assertLayoutScrollsWithTallChild(page, 'settings', 'settings-layout');
  });
});
