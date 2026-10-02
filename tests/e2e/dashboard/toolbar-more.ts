import type { Page } from '@playwright/test';

// #968 moved secondary anchor-map controls into a collapsed <details>. Open it (idempotent) before using them.
export async function openToolbarMore(page: Page): Promise<void> {
  const more = page.locator('#tab-anchor-map .m-toolbar-more');
  if (!(await more.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await more.locator('summary').click();
  }
}
