import { expect, test, type Page } from '@playwright/test';

// #1724: jobs schedule/timeline show Korean labels; no raw ms / English queue keys; cells stay in card.

const JOBS = [
  {
    name: 'cleanup',
    description: '타입별 보관 기간과 망각 점수로 만료된 기억을 먼저 숨기고, 유예가 지나면 완전히 지웁니다',
    intervalMs: 86400000,
    lastExecution: '2026-11-14T05:00:00.000Z',
    errorCount: 0,
    isRunning: false,
    paused: false,
  },
  {
    name: 'monitoring',
    description: '메모리·DB 크기·쿼리 지연 같은 자원 지표를 모아 경고합니다',
    intervalMs: 300000,
    lastExecution: '2026-11-14T05:01:00.000Z',
    errorCount: 0,
    isRunning: false,
    paused: false,
  },
  {
    name: 'rejection_gate_drift_check',
    description: '기각 게이트 드리프트 점검',
    intervalMs: 21600000,
    lastExecution: '2026-11-14T04:00:00.000Z',
    errorCount: 0,
    isRunning: false,
    paused: false,
  },
];

async function installJobsRoutes(page: Page): Promise<void> {
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
  await page.route('**/admin/batch/stats**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        timestamp: '2026-11-14T05:00:00.000Z',
        schedulerRunning: true,
        readOnly: true,
        jobs: JOBS,
        health: {
          runningJobs: 0,
          queueSize: 0,
          errorRate: 0,
          memoryUsage: 40,
          uptimeHuman: '1h',
        },
        queue: { size: 0, runningCount: 0, runningNames: [], queuedNames: [] },
      }),
    }),
  );
  await page.route('**/admin/status**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ batchImpact: { status: 'ok', failedRunCount: 0, durationHuman: '0초' } }),
    }),
  );
  await page.route('**/admin/batch/run-history**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [] }),
    }),
  );
  await page.route('**/admin/batch/runs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        runs: [
          {
            id: 'jr1',
            jobName: 'cleanup',
            trigger: 'schedule',
            startedAt: '2026-11-14T05:00:00.000Z',
            endedAt: '2026-11-14T05:00:01.000Z',
            success: true,
            durationMs: 1000,
          },
        ],
        limit: 50,
      }),
    }),
  );
}

async function openJobsTab(page: Page): Promise<void> {
  const tab = page.locator('#dashboard-tab-jobs');
  if (!(await tab.isVisible())) {
    await page.locator('#dashboard-nav-toggle').click();
    await expect(tab).toBeVisible();
  }
  await tab.click();
  await expect(page.locator('#jobs-schedule-tbody tr')).toHaveCount(JOBS.length, {
    timeout: 10_000,
  });
}

async function measureJobsSchedule(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector('#jobs-schedule-table');
    const wrap = document.querySelector('#jobs-schedule-table-wrap');
    if (!table || !wrap) {
      return { clipped: [], englishHits: [], text: '' };
    }
    const clipped: Array<{ text: string; right: number; wrapRight: number }> = [];
    const wrapRight = wrap.getBoundingClientRect().right;
    for (const td of Array.from(table.querySelectorAll('tbody td'))) {
      const box = td.getBoundingClientRect();
      if (box.width < 1) continue;
      if (box.right > wrapRight + 2) {
        clipped.push({
          text: (td.textContent || '').slice(0, 40),
          right: Math.round(box.right),
          wrapRight: Math.round(wrapRight),
        });
      }
    }
    const text = (table.innerText || '') + ' ' + (document.querySelector('#jobs-queue-summary')?.textContent || '');
    const englishHits = [
      'runningCount',
      'size=',
      '86400000',
      '300000',
      'schedule',
      'PerformanceMonitor',
      'HealthChecker',
      'soft delete',
    ].filter((token) => text.includes(token));
    return { clipped, englishHits, text: text.slice(0, 200) };
  });
}

test.describe('jobs table wrap (#1724)', () => {
  for (const width of [390, 1280] as const) {
    test(`schedule stays readable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await installJobsRoutes(page);
      await page.goto('/dashboard');
      await openJobsTab(page);

      await expect(page.locator('#jobs-schedule-table thead')).toContainText('간격');
      await expect(page.locator('#jobs-schedule-table thead')).not.toContainText('간격 ms');
      await expect(page.locator('#jobs-schedule-tbody')).toContainText('망각 정책 배치');
      await expect(page.locator('#jobs-schedule-tbody')).toContainText('매일');
      await expect(page.locator('#jobs-schedule-tbody')).toContainText('5분마다');
      await expect(page.locator('#jobs-queue-summary')).toContainText('대기열');
      await expect(page.locator('#jobs-queue-summary')).not.toContainText('runningCount');

      const report = await measureJobsSchedule(page);
      expect(report.englishHits, `english: ${JSON.stringify(report.englishHits)}`).toEqual([]);
      expect(report.clipped, `clipped: ${JSON.stringify(report.clipped)}`).toEqual([]);
    });
  }

  test('reverting interval formatter exposes raw ms (counter-check)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installJobsRoutes(page);
    await page.goto('/dashboard');
    await openJobsTab(page);
    await page.evaluate(() => {
      const ns = (window as unknown as { __MEMENTO_JOBS_PANEL__: { formatIntervalHuman: (n: number) => string } })
        .__MEMENTO_JOBS_PANEL__;
      ns.formatIntervalHuman = (n: number) => String(n);
      const jobs = (
        window as unknown as { __MEMENTO_JOBS_PANEL__: { state: { lastStats: { jobs: unknown } }; renderSchedule: (j: unknown) => void } }
      ).__MEMENTO_JOBS_PANEL__;
      jobs.renderSchedule(jobs.state.lastStats.jobs);
    });
    await expect(page.locator('#jobs-schedule-tbody')).toContainText('86400000');
  });
});
