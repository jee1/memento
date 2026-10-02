import { expect, test } from '@playwright/test';

import {
  API_KEY,
  KO_IMPORT,
  KO_KEY_CLEARED_ON_RELOAD,
  KO_KEY_REQUIRED,
  KO_TOKENS,
  SECRET,
  createAudit,
  installDashboardRoutes,
  observation,
  openAgentSessions,
  session,
} from './agent-sessions.fixtures.js';

test.describe('Agent Sessions dashboard', () => {
  test('renders loading, empty, error, and degraded states', async ({ page }) => {
    await installDashboardRoutes(page, { sessions: [], sessionsDelayMs: 150 });
    await page.goto('/dashboard');
    await page.locator('#dashboard-tab-agent-sessions').click();
    await page.locator('#as-api-key').fill(API_KEY);
    await page.locator('#as-auth-form button[type="submit"]').click();
    await expect(page.locator('#as-loading')).toBeVisible();
    await expect(page.locator('#as-empty')).toBeVisible();

    await page.unroute('**/api/v1/agent/**');
    await installDashboardRoutes(page, {
      sessionsStatus: 503,
      sessionsMessage: 'Dashboard temporarily degraded.',
    });
    await page.locator('#as-refresh-sessions').click();
    await expect(page.getByRole('alert')).toContainText('Dashboard temporarily degraded.');

    await page.unroute('**/api/v1/agent/**');
    await installDashboardRoutes(page, {
      sessions: [
        session('session-degraded', {
          status: 'DEGRADED',
          degraded: true,
          degraded_reason: 'capture backlog',
        }),
      ],
    });
    await page.locator('#as-refresh-sessions').click();
    await page.getByRole('button', { name: /session-degraded/ }).click();
    await expect(page.locator('.as-state-badge--degraded')).toContainText('capture backlog');
  });

  test('applies session filters and cursor pagination', async ({ page }) => {
    await installDashboardRoutes(page, {
      sessionPages: [
        { sessions: [session('session-page-1')], next_cursor: 'session-cursor-2' },
        { sessions: [session('session-page-2')], next_cursor: null },
      ],
    });
    await openAgentSessions(page);
    await page.locator('#as-session-status').selectOption('COMPLETED');
    await page.locator('#as-session-adapter').fill('claude-code');
    await page.locator('#as-session-owner').fill('owner-filter');
    await page.locator('#as-session-project').fill('project-filter');

    const filteredRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === '/api/v1/agent/sessions' &&
        url.searchParams.get('status') === 'COMPLETED';
    });
    await page.locator('#as-refresh-sessions').click();
    const filteredUrl = new URL((await filteredRequest).url());
    expect(filteredUrl.searchParams.get('adapter')).toBe('claude-code');
    expect(filteredUrl.searchParams.get('owner_id')).toBe('owner-filter');
    expect(filteredUrl.searchParams.get('project_id')).toBe('project-filter');

    const cursorRequest = page.waitForRequest((request) =>
      request.url().includes('cursor=session-cursor-2'),
    );
    await page.locator('#as-load-more-sessions').click();
    await cursorRequest;
    await expect(page.getByText('session-page-2')).toBeVisible();
  });

  test('visually distinguishes timeline events and bounds a 10k session to 100 rows', async ({
    page,
  }) => {
    const tenThousandObservations = Array.from({ length: 10_000 }, (_, index) =>
      observation(`observation-${index}`, 'USER_PROMPT'),
    );
    tenThousandObservations.splice(
      1,
      4,
      observation('observation-tool', 'TOOL_CALL'),
      observation('observation-result', 'TOOL_RESULT'),
      observation('observation-error', 'ERROR', { status: 'DEGRADED' }),
      observation('observation-response', 'ASSISTANT_RESPONSE'),
    );
    await installDashboardRoutes(page, {
      sessions: [session('session-10k', { aggregate: { total: 10_000 } })],
      observations: tenThousandObservations,
    });
    await openAgentSessions(page);

    const startedAt = performance.now();
    await page.getByRole('button', { name: /session-10k/ }).click();
    await expect(page.locator('#as-timeline .as-event')).toHaveCount(100);
    expect(performance.now() - startedAt).toBeLessThan(3_000);
    await expect(page.locator('.as-event--prompt')).toHaveCount(96);
    await expect(page.locator('.as-event--tool')).toHaveCount(1);
    await expect(page.locator('.as-event--result')).toHaveCount(1);
    await expect(page.locator('.as-event--error')).toHaveCount(1);
    await expect(page.locator('.as-event--response')).toHaveCount(1);

    const observationRequest = page
      .context()
      .pages()[0]
      .waitForRequest((request) => request.url().includes('cursor=100'));
    await page.locator('#as-load-more-observations').click();
    await observationRequest;
    await expect(page.locator('#as-timeline .as-event')).toHaveCount(200);

    await page.locator('#as-event-type').selectOption('ERROR');
    await page.locator('#as-observation-status').selectOption('DEGRADED');
    const filterRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/observations') &&
        url.searchParams.get('event_type') === 'ERROR' &&
        url.searchParams.get('status') === 'DEGRADED';
    });
    await page.locator('#as-refresh-timeline').click();
    await filterRequest;
    await expect(page.locator('#as-timeline .as-event')).toHaveCount(1);
    await expect(page.locator('.as-event--error')).toContainText('observation-error');

    const requests = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('/observations')),
    );
    expect(requests.every((url) => new URL(url).searchParams.get('limit') === '100')).toBe(true);
  });

  test('navigates provenance in one action and shows selected/excluded injection reasons', async ({
    page,
  }) => {
    await installDashboardRoutes(page, {
      injections: [
        {
          injection_id: 'injection-1',
          token_used: 80,
          token_budget: 100,
          status: 'completed',
          candidates: [
            {
              memory_id: 'memory-selected',
              score: 0.9,
              token_estimate: 40,
              used: true,
              decision: 'selected',
              reason: 'highest relevance',
            },
            {
              memory_id: 'memory-excluded',
              score: 0.2,
              token_estimate: 60,
              used: false,
              decision: 'excluded',
              reason: 'budget threshold',
            },
          ],
        },
      ],
    });
    await openAgentSessions(page);
    await page.getByRole('button', { name: /session-1/ }).click();
    await page.locator('#as-dtab-injections').click();
    await expect(page.locator('#as-injections')).toContainText(`${KO_TOKENS} 80 / 100`);
    await expect(page.getByText(/memory-selected/).locator('..')).toContainText('highest relevance');
    await expect(page.getByText(/memory-excluded/).locator('..')).toContainText('budget threshold');

    const detailRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/agent/provenance/detail')) {
        detailRequests.push(request.url());
      }
    });
    await page
      .getByText('memory-selected', { exact: true })
      .locator('..')
      .locator('button')
      .click();
    await expect(page.locator('#as-provenance-results')).toContainText('observation-1');
    await expect(page.locator('#as-provenance-results')).toContainText('session-1');
    expect(detailRequests).toHaveLength(1);

    await page.locator('#as-timeline .as-event__trace').click();
    await expect(page.locator('#as-provenance-results')).toContainText('memory-1');
    expect(detailRequests).toHaveLength(2);
  });

  test('requires dry-run, rolls back invalid input, and reports duplicate imports', async ({
    page,
  }) => {
    const backend = await installDashboardRoutes(page);
    await openAgentSessions(page);
    const transcript = page.locator('#as-transcript-jsonl');
    const importButton = page.locator('#as-transcript-import');

    await transcript.fill('{"event_id":"valid-event"}');
    await expect(importButton).toBeDisabled();
    await page.locator('#as-transcript-dry-run').click();
    await expect(page.getByText(/Dry-run: valid · accepted 1/)).toBeVisible();
    await expect(importButton).toBeEnabled();
    await importButton.click();
    await expect(page.locator('#as-import-results')).toContainText(`${KO_IMPORT}: valid · accepted 1`);
    expect(backend.importedRows()).toBe(1);

    await transcript.fill('invalid-json');
    await page.locator('#as-transcript-dry-run').click();
    await expect(page.getByRole('alert')).toContainText('Transcript validation failed.');
    await expect(importButton).toBeDisabled();
    expect(backend.importedRows()).toBe(1);

    await transcript.fill('{"event_id":"duplicate-event"}');
    await page.locator('#as-transcript-dry-run').click();
    await importButton.click();
    await expect(page.getByText(/duplicate 1/)).toBeVisible();
    expect(backend.importedRows()).toBe(1);
  });

  test('clears the API key on reload and exposes no secret in DOM, console, or API responses', async ({
    page,
  }) => {
    const audit = createAudit(page);
    await installDashboardRoutes(page);
    await openAgentSessions(page, SECRET);
    await expect(page.getByText('session-1')).toBeVisible();
    await audit.settleResponses();
    expect(await page.locator('body').textContent()).not.toContain(SECRET);
    expect(audit.consoleMessages.join('\n')).not.toContain(SECRET);
    expect(audit.pageErrors.join('\n')).not.toContain(SECRET);
    expect(audit.responseBodies.join('\n')).not.toContain(SECRET);

    await page.reload();
    await page.locator('#dashboard-tab-agent-sessions').click();
    await expect(page.locator('#as-api-key')).toHaveValue('');
    await expect(page.locator('#as-status')).toContainText(KO_KEY_CLEARED_ON_RELOAD);
    await page.locator('#as-refresh-sessions').click();
    await expect(page.getByRole('alert')).toContainText(
      KO_KEY_REQUIRED,
    );
    await audit.settleResponses();
    expect(await page.locator('html').textContent()).not.toContain(SECRET);
    expect(audit.consoleMessages.join('\n')).not.toContain(SECRET);
    expect(audit.responseBodies.join('\n')).not.toContain(SECRET);
  });
});
