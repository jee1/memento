import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const dashboardHtmlPath = resolve(process.cwd(), 'static/dashboard.html');
const dashboardFetchPath = resolve(process.cwd(), 'static/js/memento-admin-fetch.js');

describe('dashboard auth assets', () => {
  it('does not load the browser key config script from dashboard.html', () => {
    const dashboardHtml = readFileSync(dashboardHtmlPath, 'utf8');

    expect(dashboardHtml).not.toContain('/static/js/memento-admin-config.js');
  });

  it('does not keep browser api key fallback logic in memento-admin-fetch.js', () => {
    const dashboardFetch = readFileSync(dashboardFetchPath, 'utf8');

    expect(dashboardFetch).not.toContain('sessionStorage');
    expect(dashboardFetch).not.toContain('__MEMENTO_ADMIN_FETCH_CONFIG__');
    expect(dashboardFetch).not.toContain('Authorization');
  });
});
