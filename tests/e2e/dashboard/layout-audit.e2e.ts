import { expect, test, type Page } from '@playwright/test';

/**
 * #1726 r5 / #1724: full-dashboard layout audit.
 * Pointed keep-all / clip fixes missed siblings four times; this lever scans every
 * visible text surface across 7 tabs × 5 viewports for clip, parent escape,
 * Korean mid-어절 breaks, and leftover English outside the PR allowlist.
 */

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;

const TABS = [
  { key: 'ops-status', id: 'dashboard-tab-ops-status', panel: '#tab-ops-status' },
  { key: 'review', id: 'dashboard-tab-review', panel: '#tab-review-candidates' },
  { key: 'jobs', id: 'dashboard-tab-jobs', panel: '#tab-jobs' },
  { key: 'memory-finder', id: 'dashboard-tab-memory-finder', panel: '#tab-memory-finder' },
  { key: 'anchor', id: 'dashboard-tab-anchor', panel: '#tab-anchor-map' },
  { key: 'graph', id: 'dashboard-tab-graph', panel: '#tab-graph' },
  { key: 'settings', id: 'dashboard-tab-settings', panel: '#tab-settings' },
] as const;

const LONG_SESSION = 'session:060b5ba177df9451';

const LONG_KO =
  '이 기억은 매우 긴 본문으로서 관리자가 읽을 때 한글 어절이 줄 끝에서 중간에 끊기지 않고 통째로 다음 줄로 넘어가야 하며 검색 거부 게이트와 절차 추출 전략을 설명한다';

const mapPayload = {
  agent_id: 'default',
  anchors: [
    { agent_id: 'default', slot: 'A', memory_id: 'mem_anchor_a', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
    { agent_id: 'default', slot: 'B', memory_id: 'mem_anchor_b', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
    { agent_id: 'default', slot: 'C', memory_id: 'mem_anchor_c', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
  ],
  nodes: [
    { id: 'mem_anchor_a', type: 'anchor', slot: 'A', content: '슬롯 A 앵커', importance: 0.9, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'mem_anchor_b', type: 'anchor', slot: 'B', content: '슬롯 B 앵커', importance: 0.8, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'mem_anchor_c', type: 'anchor', slot: 'C', content: '슬롯 C 앵커', importance: 0.7, created_at: '2026-06-21T00:00:00.000Z' },
    {
      id: 'mem_a',
      type: 'memory',
      content: '검색 가능한 기억',
      hop_distance: 1,
      similarity: 0.93,
      importance: 0.6,
      created_at: '2026-06-21T00:00:00.000Z',
      anchors: [{ slot: 'A', hop_distance: 1 }],
    },
    {
      id: 'mem_b',
      type: 'memory',
      content: '관련 기억',
      hop_distance: 2,
      similarity: 0.72,
      importance: 0.4,
      created_at: '2026-06-21T00:00:00.000Z',
      anchors: [{ slot: 'B', hop_distance: 2 }],
    },
  ],
  links: [
    { source: 'mem_anchor_a', target: 'mem_a', type: 'hop', hop_distance: 1, similarity: 0.93 },
    { source: 'mem_anchor_b', target: 'mem_b', type: 'hop', hop_distance: 2, similarity: 0.72 },
  ],
  timestamp: '2026-06-21T00:00:00.000Z',
};

function setting(overrides: Record<string, unknown>) {
  return {
    key: 'SUPERSEDE_APPLY_ENABLED',
    description: '사람이 승인한 대체 후보를 적용하는 관리 경로를 켠다.',
    kind: 'boolean',
    allowed: ['true', 'false'],
    apply: 'immediate',
    risk: 'medium',
    value: 'false',
    source: 'default',
    default_value: 'false',
    default_source: 'shared/config/index.ts',
    env_value: null,
    override: null,
    pending_restart: false,
    last_change: {
      action: 'set',
      actor: LONG_SESSION,
      reason: '감사 픽스처',
      created_at: '2026-11-14T05:00:00.000Z',
    },
    ...overrides,
  };
}

async function installAllRoutes(page: Page): Promise<void> {
  await page.route('**/admin/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not mocked' }) }),
  );
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/graph**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>그래프</body></html>' }),
  );

  await page.route('**/api/anchors/agents', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agents: [{ agent_id: 'default', anchor_count: 3 }],
        agent_ids: ['default'],
        timestamp: '2026-06-21T00:00:00.000Z',
      }),
    }),
  );
  await page.route('**/api/anchors/map?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mapPayload) }),
  );

  await page.route('**/admin/ops/summary**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        zones: {
          system_ok: [
            { key: 'process_database', value: 'connected', unit: null, severity: 'ok', as_of: null, window: { period: '30d' } },
          ],
          doing_work: [
            { key: 'search_query_count', value: 464, unit: 'count', severity: null, as_of: null, window: { period: '7d' } },
          ],
          needs_action: [
            { key: 'review_pending_total', value: 500, unit: 'count', severity: 'warn', as_of: null, window: { period: '30d' } },
          ],
        },
        window: { period: '7d', from: null, to: null },
      }),
    }),
  );

  await page.route('**/admin/memory/review-candidates?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            id: '7dd21418-fd47-4a2b-9c1d-abcdef012345',
            memory_id: 'mem_1762772305abcdef0123456789deadbeef',
            priority: 1300,
            status: 'pending',
            reason: 'eligible: importance=1.000>=0.4, stale=20d>=14d, anchor=last_recalled_at',
            due_at: '2026-11-01T12:40:38.000Z',
          },
        ],
        pagination: { page: 1, page_size: 25, total_count: 1, total_pages: 1, has_prev: false, has_next: false },
        timestamp: '2026-11-14T00:00:00Z',
      }),
    }),
  );
  await page.route('**/admin/memory/review-candidates/metrics**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        live: {
          pendingTotal: 1,
          window1h: { candidatesCreated: 0, processedTotal: 2, netFlow: 0 },
        },
        snapshots: [
          {
            sampled_at: '2026-11-14T05:00:00.000Z',
            pending_total: 1,
            net_flow_1h: 0,
            created_last_1h: 0,
            reviewed_last_1h: 2,
            dismissed_last_1h: 0,
            expired_last_1h: 0,
          },
        ],
      }),
    }),
  );
  await page.route('**/admin/memory/supersede-candidates?**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [
          {
            id: 'sc-0',
            lifecycle_status: 'not_applied',
            verdict: 'pending',
            project_id: 'memento',
            old_memory_id: 'mem_old_17627723050000',
            new_memory_id: 'mem_new_17627723059999',
            old_content_preview: LONG_KO,
            new_content_preview: LONG_KO + ' 갱신본',
            rationale: LONG_KO,
            evidence_quote: LONG_KO,
            provider: 'minilm',
            model: 'local',
            judged_at: '2026-11-14T05:00:00.000Z',
            supersede_apply_enabled: true,
            old_superseded_by: null,
          },
          {
            id: 'sc-1',
            lifecycle_status: 'applied',
            verdict: 'confirmed',
            project_id: 'memento',
            old_memory_id: 'mem_old_17627723050001',
            new_memory_id: 'mem_new_17627723059998',
            old_content_preview: LONG_KO,
            new_content_preview: LONG_KO + ' 적용본',
            rationale: LONG_KO,
            evidence_quote: LONG_KO,
            provider: 'minilm',
            model: 'local',
            judged_at: '2026-11-14T04:00:00.000Z',
            supersede_apply_enabled: false,
            old_superseded_by: null,
          },
        ],
        pagination: { page: 1, page_size: 25, total_count: 2, total_pages: 1, has_prev: false, has_next: false },
      }),
    }),
  );

  await page.route('**/admin/batch/stats**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        timestamp: '2026-11-14T05:00:00.000Z',
        schedulerRunning: true,
        readOnly: false,
        jobs: [
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
            isRunning: true,
            paused: false,
          },
          {
            name: 'memory_consolidation',
            description: '기억을 통합합니다',
            intervalMs: 3600000,
            lastExecution: '2026-11-14T04:00:00.000Z',
            errorCount: 4,
            isRunning: false,
            paused: false,
          },
          {
            name: 'rejection_gate_drift_check',
            description: '거부 게이트 드리프트를 검사합니다',
            intervalMs: 7200000,
            lastExecution: '2026-11-14T03:00:00.000Z',
            errorCount: 0,
            isRunning: false,
            paused: true,
          },
        ],
        health: { runningJobs: 1, queueSize: 1, errorRate: 0.1, memoryUsage: 40, uptimeHuman: '1h' },
        queue: { size: 1, runningCount: 1, runningNames: ['monitoring'], queuedNames: ['cleanup'] },
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
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [] }) }),
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

  await page.route('**/admin/memory/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'mem_e2e',
            type: 'semantic',
            content_preview: '기억 찾기 미리보기',
            similarity: 0.42,
            created_at: '2026-10-01T00:00:00Z',
          },
        ],
        total_count: 1,
        filters_applied: { q: '기억', limit: 25 },
      }),
    }),
  );
  await page.route('**/admin/memory/items/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Memory item',
        memory: {
          id: 'mem_e2e',
          type: 'semantic',
          content: '기억 찾기 본문',
          importance: 0.5,
          privacy_scope: 'private',
          pinned: false,
          created_at: '2026-10-01T00:00:00Z',
          last_accessed: null,
          tags: null,
          source: null,
          project_id: null,
          owner_id: null,
        },
      }),
    }),
  );

  await page.route('**/admin/settings/events**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          {
            id: 'e1',
            setting_key: 'SUPERSEDE_APPLY_ENABLED',
            action: 'set',
            previous_value: null,
            new_value: 'true',
            actor: LONG_SESSION,
            reason: '감사 픽스처',
            created_at: '2026-11-01T00:00:00.000Z',
          },
        ],
      }),
    }),
  );
  await page.route('**/admin/embedding-health**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        diagnostics: {
          provider: 'minilm',
          memoryCount: 10,
          validEmbeddingCount: 10,
          coverage: 1,
          diagnosedAt: '2026-11-14T05:00:00.000Z',
          missingEmbeddingCount: 0,
          unreadableEmbeddingCount: 0,
          dimensionMismatchCount: 0,
          providerDriftCount: 0,
          modelDriftCount: 0,
        },
      }),
    }),
  );

  await page.route('**/admin/settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        settings: [
          setting({}),
          setting({
            key: 'SUPERSEDE_CANDIDATE_SCAN_ENABLED',
            description: '대체 후보 스캔을 켠다.',
            value: 'true',
            default_value: 'false',
          }),
          setting({
            key: 'PROCEDURAL_EXTRACTION_STRATEGY',
            description: '절차 추출 전략.',
            kind: 'enum',
            allowed: ['rule_only', 'llm_only', 'hybrid'],
            value: 'rule_only',
            default_value: 'rule_only',
            default_source: 'shared/config/constants.ts',
            last_change: null,
          }),
        ],
        read_only: [
          { key: 'EMBEDDING_PROVIDER', secret: false, set: true, value: 'minilm' },
        ],
      }),
    }),
  );
}

async function openTab(page: Page, tab: (typeof TABS)[number]): Promise<void> {
  const btn = page.locator(`#${tab.id}`);
  if (!(await btn.isVisible())) {
    await page.locator('#dashboard-nav-toggle').click();
    await expect(btn).toBeVisible();
  }
  await btn.click();
  await expect(page.locator(tab.panel)).toBeVisible({ timeout: 10_000 });
}

async function openAllDetailsInActivePanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.tab-panel.active details').forEach((d) => {
      (d as HTMLDetailsElement).open = true;
    });
  });
}

async function prepareTabState(page: Page, tabKey: string): Promise<void> {
  if (tabKey === 'jobs') {
    await expect(page.locator('#jobs-schedule-tbody tr')).toHaveCount(4, { timeout: 10_000 });
    await expect(page.locator('.jobs-row-menu')).toHaveCount(4, { timeout: 10_000 });
    await expect(page.locator('#jobs-timeline-tbody tr')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('#jobs-drawer')).toBeVisible();
    await page.evaluate(() => {
      document.querySelectorAll('.jobs-row-menu').forEach((d) => {
        (d as HTMLDetailsElement).open = true;
      });
    });
  }
  if (tabKey === 'settings') {
    await expect(page.locator('#settings-tbody tr').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#settings-events-tbody tr').first()).toBeVisible({ timeout: 10_000 });
  }
  if (tabKey === 'review') {
    await expect(page.locator('#rc-table tbody tr').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('#rc-diagnostics').evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await expect(page.locator('.rc-queue-verdict__action')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.rc-bulk-effect-note')).toBeVisible();
    await page.locator('#rc-supersede-section').evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await expect(page.locator('#sc-table-body tr')).toHaveCount(2, { timeout: 10_000 });
    await page.locator('#sc-table-body tr').first().click();
    await expect(page.locator('#sc-detail')).toBeVisible({ timeout: 10_000 });
  }
  if (tabKey === 'anchor') {
    await expect(page.locator('#anchor-list .anchor-item')).toHaveCount(3, { timeout: 10_000 });
    await page.evaluate(() => {
      const api = (window as unknown as {
        __MEMENTO_ANCHOR_MAP__?: { displayMemoryDetails?: (node: unknown) => void };
      }).__MEMENTO_ANCHOR_MAP__;
      if (!api || typeof api.displayMemoryDetails !== 'function') {
        throw new Error('__MEMENTO_ANCHOR_MAP__.displayMemoryDetails missing');
      }
      api.displayMemoryDetails({
        id: 'mem_a',
        type: 'memory',
        content: '검색 가능한 기억',
        hop_distance: 1,
        similarity: 0.93,
        importance: 0.6,
        created_at: '2026-06-21T00:00:00.000Z',
        anchors: [{ slot: 'A', hop_distance: 1 }],
      });
    });
    await expect(page.locator('#memory-details')).toContainText('소속');
    await expect(page.locator('.legend-note')).toBeVisible();
  }
  if (tabKey === 'memory-finder') {
    await page.locator('#mf-id-input').fill('mem_e2e');
    await page.locator('#mf-id-open').click();
    await expect(page.locator('#mf-d-id')).toContainText('mem_e2e', { timeout: 10_000 });
  }
  if (tabKey === 'ops-status') {
    await expect(page.locator('.ops-row').first()).toBeVisible({ timeout: 10_000 });
  }
  await openAllDetailsInActivePanel(page);
}

type Finding = {
  kind: 'clipped' | 'outside' | 'korean_mid_break' | 'english' | 'crushed_word';
  tab: string;
  viewport: string;
  selector: string;
  text: string;
  detail: string;
};

async function scanActivePanel(page: Page, tab: string, viewport: string): Promise<Finding[]> {
  return page.evaluate(
    ({ tabName, vp }) => {
      const findings: Finding[] = [];
      const root = document.querySelector('.tab-panel.active') as HTMLElement | null;
      if (!root) return findings;

      const allowEnglish = [
        /^[A-Z][A-Z0-9_]*$/,
        /^(cleanup|monitoring|memory_consolidation|rejection_gate_drift_check|schedule|semantic|private|connected|count|ok|warn|crit|idle)$/i,
        /^(minilm|tfidf|off|rule_only|llm_only|hybrid|true|false|openai|gemini|typesafe|jev|memento|pending|confirmed|applied)$/i,
        /^mem[_-]/i,
        /^session:[0-9a-f]+$/i,
        /^[ABC]$/,
        /^ms$/i,
        /^recall$/i,
        /^env$/i,
        /^DB$/,
        /^LLM$/,
        /^HealthChecker$/,
        /^PerformanceMonitor$/,
        /^native$/,
        /^embedding$/i,
        /^agent_id$/,
        /^default$/,
        /^eligible$/,
        /^importance$/,
        /^stale$/,
        /^anchor$/,
        /^last_recalled_at$/,
        /^created_at_fallback$/,
        /^created_at$/,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        /^shared$/,
        /^config$/,
        /^index\.ts$/,
        /^constants\.ts$/,
        /^d$/,
        /^h$/,
        /^sc-\d+$/,
        /^local$/i,
        /^\d{4}-\d{2}-\d{2}T[\d:.Z+-]+$/,
        /^T\d{2}:[\d:.Z+-]+$/,
      ];

      function shown(el: Element): boolean {
        let cur: Element | null = el;
        while (cur && cur !== root.parentElement) {
          if (cur.classList.contains('hidden') || cur.hasAttribute('hidden')) return false;
          if (cur.tagName === 'DETAILS' && !(cur as HTMLDetailsElement).open) {
            const summary = cur.querySelector(':scope > summary');
            const inSummary = Boolean(summary && (el === summary || summary.contains(el)));
            if (!inSummary && el !== cur) return false;
          }
          const cs = getComputedStyle(cur);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          if (cs.clip && cs.clip !== 'auto' && /rect\(\s*0/.test(cs.clip)) return false;
          cur = cur.parentElement;
        }
        const r = el.getBoundingClientRect();
        const own = getComputedStyle(el);
        if (r.width < 0.5 || r.height < 0.5) return false;
        if (own.visibility === 'hidden' || own.display === 'none' || own.opacity === '0') return false;
        return true;
      }

      function intendedEllipsis(el: HTMLElement): boolean {
        const cs = getComputedStyle(el);
        if (cs.textOverflow === 'ellipsis') return true;
        if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') return true;
        const hasTitle = Boolean(el.getAttribute('title') || el.title);
        if (!hasTitle) return false;
        return false;
      }

      function cssPath(el: Element): string {
        const parts: string[] = [];
        let cur: Element | null = el;
        while (cur && parts.length < 4) {
          let part = cur.tagName.toLowerCase();
          if (cur.id) part += '#' + cur.id;
          else if (typeof cur.className === 'string' && cur.className.trim()) {
            part += '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.');
          }
          parts.unshift(part);
          cur = cur.parentElement;
          if (cur && cur.classList.contains('tab-panel')) break;
        }
        return parts.join('>');
      }

      const CELL_SELECTOR =
        'td, th, .ops-status-card, .ops-row, .m-card, .memory-detail-item, .map-legend, .rc-queue-verdict, .settings-edit, .settings-default, .jobs-drawer, .jobs-schedule__name-cell, .rc-cell-reason, .legend-note, .rc-bulk-effect-note, .m-stat, .settings-readonly__row';

      function parentBox(el: Element): DOMRect | null {
        let cur = el.parentElement;
        while (cur && cur !== root.parentElement) {
          if (cur.matches(CELL_SELECTOR)) return cur.getBoundingClientRect();
          cur = cur.parentElement;
        }
        return null;
      }

      function textBearingChildren(el: Element): Element[] {
        return Array.from(el.children).filter((child) => (child.textContent || '').replace(/\s+/g, ' ').trim().length > 0);
      }

      const LEAF_TAGS = new Set([
        'TD', 'TH', 'BUTTON', 'P', 'LABEL', 'SPAN', 'A', 'LI', 'DT', 'DD',
        'H1', 'H2', 'H3', 'H4', 'STRONG', 'SUMMARY', 'OPTION', 'CODE', 'DIV',
      ]);

      function isLeafSurface(el: HTMLElement): boolean {
        if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
        if (textBearingChildren(el).length > 0) return false;
        return LEAF_TAGS.has(el.tagName);
      }

      const selectors = [
        'th', 'td', 'label', 'p', 'span', 'div', 'button', 'a', 'li', 'dt', 'dd',
        'h1', 'h2', 'h3', 'h4', 'strong', 'summary', 'option', 'code', 'select', 'input',
      ];
      function pushFinding(kind: Finding['kind'], el: Element, text: string, detail: string): void {
        findings.push({
          kind,
          tab: tabName,
          viewport: vp,
          selector: cssPath(el),
          text: text.slice(0, 80),
          detail,
        });
      }

      function noteKoreanBreaks(el: HTMLElement): void {
        const cs = getComputedStyle(el);
        // nowrap/ellipsis overflow is truncation, not a visible mid-어절 wrap.
        if (cs.whiteSpace === 'nowrap' || cs.textOverflow === 'ellipsis') return;
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType !== Node.TEXT_NODE) continue;
          const raw = child.textContent || '';
          const re = /[\uAC00-\uD7A3]+/g;
          let match: RegExpExecArray | null;
          while ((match = re.exec(raw))) {
            const range = document.createRange();
            range.setStart(child, match.index);
            range.setEnd(child, match.index + match[0].length);
            const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
            if (rects.length >= 2) {
              pushFinding('korean_mid_break', el, match[0], `rects=${rects.length}`);
            }
          }
        }
      }

      /** Cell squeezed to ~1–2 glyph widths: one word paints on ≥3 lines, each line ≤1.75em. */
      function noteCrushedWords(el: HTMLElement): void {
        const style = getComputedStyle(el);
        if (style.whiteSpace === 'nowrap' || style.textOverflow === 'ellipsis') return;
        const em = parseFloat(style.fontSize) || 14;
        const maxLine = em * 1.75;
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType !== Node.TEXT_NODE) continue;
          const raw = child.textContent || '';
          const re = /[\uAC00-\uD7A3]{2,}|[A-Za-z][A-Za-z0-9_.:-]{1,}/g;
          let match: RegExpExecArray | null;
          while ((match = re.exec(raw))) {
            if (match[0].length < 2) continue;
            const range = document.createRange();
            range.setStart(child, match.index);
            range.setEnd(child, match.index + match[0].length);
            const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
            if (rects.length < 3) continue;
            if (!rects.every((r) => r.width <= maxLine)) continue;
            pushFinding(
              'crushed_word',
              el,
              match[0],
              `rects=${rects.length} maxLineW=${Math.round(Math.max(...rects.map((r) => r.width)))}`,
            );
          }
        }
      }

      function noteEnglish(el: HTMLElement, text: string): void {
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent || '')
          .join(' ');
        const selectedLabel = el.tagName === 'SELECT'
          ? ((el as HTMLSelectElement).selectedOptions[0]?.textContent || '')
          : '';
        const scanText = el.tagName === 'SELECT' ? selectedLabel : (own.trim() ? own : text);
        const tokens = scanText.match(/[A-Za-z][A-Za-z0-9_.:-]*/g) || [];
        for (const token of tokens) {
          if (allowEnglish.some((re) => re.test(token))) continue;
          if (token.length === 1 && !/^[ABC]$/.test(token)) continue;
          pushFinding('english', el, token, `in "${text.slice(0, 60)}"`);
        }
      }

      function inspect(el: HTMLElement): void {
        if (!shown(el)) return;
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text && el.tagName !== 'INPUT') return;
        const leaf = isLeafSurface(el);
        if (leaf && el.scrollWidth > el.clientWidth + 1 && !intendedEllipsis(el)) {
          pushFinding('clipped', el, text, `scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`);
        }
        if (leaf) {
          const box = el.getBoundingClientRect();
          const pb = parentBox(el);
          if (pb && (box.right > pb.right + 1.5 || box.left < pb.left - 1.5)) {
            pushFinding('outside', el, text, `elRight=${Math.round(box.right)} parentRight=${Math.round(pb.right)}`);
          }
        }
        noteKoreanBreaks(el);
        noteCrushedWords(el);
        if (leaf) noteEnglish(el, text);
      }

      const nodes = Array.from(root.querySelectorAll(selectors.join(','))) as HTMLElement[];
      for (const el of nodes) inspect(el);

      return findings;
    },
    { tabName: tab, vp: viewport },
  );
}

test.describe('dashboard layout audit (#1726 r5)', () => {
  test('7 tabs × 5 viewports: no clip, parent escape, Korean mid-break, crushed word, or leftover English', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await installAllRoutes(page);
    await page.goto('/dashboard');

    const all: Finding[] = [];

    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      const vpLabel = `${vp.width}x${vp.height}`;
      for (const tab of TABS) {
        await openTab(page, tab);
        await prepareTabState(page, tab.key);
        const found = await scanActivePanel(page, tab.key, vpLabel);
        all.push(...found);
      }
    }

    const summary = {
      clipped: all.filter((f) => f.kind === 'clipped'),
      outside: all.filter((f) => f.kind === 'outside'),
      korean_mid_break: all.filter((f) => f.kind === 'korean_mid_break'),
      crushed_word: all.filter((f) => f.kind === 'crushed_word'),
      english: all.filter((f) => f.kind === 'english'),
      total: all.length,
    };

    console.log('[layout-audit] summary', JSON.stringify({
      total: summary.total,
      clipped: summary.clipped.length,
      outside: summary.outside.length,
      korean_mid_break: summary.korean_mid_break.length,
      crushed_word: summary.crushed_word.length,
      english: summary.english.length,
    }));
    if (all.length > 0) {
      console.log('[layout-audit] findings', JSON.stringify(all, null, 2));
    }

    expect(all, `layout-audit findings (${all.length})`).toEqual([]);
  });
});
