import { expect, type Page, test } from '@playwright/test';

const mapPayload = {
  agent_id: 'default',
  anchors: [
    { agent_id: 'default', slot: 'A', memory_id: 'anchor-a', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
    { agent_id: 'default', slot: 'B', memory_id: 'anchor-b', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
    { agent_id: 'default', slot: 'C', memory_id: 'anchor-c', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
  ],
  nodes: [
    { id: 'anchor-a', type: 'anchor', slot: 'A', content: 'Slot A anchor', importance: 0.9, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'anchor-b', type: 'anchor', slot: 'B', content: 'Slot B anchor', importance: 0.8, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'anchor-c', type: 'anchor', slot: 'C', content: 'Slot C anchor', importance: 0.7, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'mem-a', type: 'memory', content: 'alpha searchable memory', hop_distance: 1, similarity: 0.93, importance: 0.6, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'mem-b', type: 'memory', content: 'beta related memory', hop_distance: 2, similarity: 0.72, importance: 0.4, created_at: '2026-06-21T00:00:00.000Z' },
  ],
  links: [
    { source: 'anchor-a', target: 'mem-a', type: 'hop', hop_distance: 1, similarity: 0.93 },
    { source: 'anchor-b', target: 'mem-b', type: 'hop', hop_distance: 2, similarity: 0.72 },
    { source: 'anchor-c', target: 'missing-node', type: 'hop', hop_distance: 1, similarity: 0.5 },
  ],
  timestamp: '2026-06-21T00:00:00.000Z',
};

const LAYOUT_KEY = 'memento.anchorMap.layout.v1';

async function circleXY(page: Page, id: string) {
  return page.evaluate((nodeId) => {
    const el = [...document.querySelectorAll('#anchor-map svg circle.node')]
      .find((c) => (c as SVGElement & { __data__?: { id?: string } }).__data__?.id === nodeId);
    return el
      ? { cx: parseFloat(el.getAttribute('cx') || 'NaN'), cy: parseFloat(el.getAttribute('cy') || 'NaN') }
      : null;
  }, id);
}

async function nodeScreenPoint(page: Page, id: string) {
  return page.evaluate((nodeId) => {
    const el = [...document.querySelectorAll('#anchor-map svg circle.node')]
      .find((c) => (c as SVGElement & { __data__?: { id?: string } }).__data__?.id === nodeId) as SVGCircleElement | undefined;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, id);
}

test.describe('Anchor Map drag refresh deferral (issue 948)', () => {
  const mapRoute = { serveWithoutMemB: false };

  test.beforeEach(async ({ page }) => {
    mapRoute.serveWithoutMemB = false;

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
    await page.route('**/api/anchors/map?**', (route) => {
      const payload = mapRoute.serveWithoutMemB
        ? {
            ...mapPayload,
            nodes: mapPayload.nodes.filter((n) => n.id !== 'mem-b'),
            links: mapPayload.links.filter((l) => l.target !== 'mem-b'),
            timestamp: '2026-06-21T00:00:05.000Z',
          }
        : mapPayload;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });

    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('memento.e2e.storageSeeded') === '1') return;
        localStorage.clear();
        sessionStorage.setItem('memento.e2e.storageSeeded', '1');
      } catch (_err) { /* ignore */ }
    });
  });

  test('defers auto-refresh while dragging, then flushes once on mouseup (A1–A5 + R4)', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/dashboard');
    await expect(page.locator('#anchor-map svg .node')).toHaveCount(5);
    await page.waitForTimeout(800);

    await page.locator('#refresh-interval-select').selectOption('5000');
    await page.locator('#auto-refresh-toggle').check();

    const start = await nodeScreenPoint(page, 'mem-a');
    expect(start).toBeTruthy();

    // Manual mouse control — hold button down >5s while polling swaps payload.
    await page.mouse.move(start!.x, start!.y);
    await page.mouse.down();
    await page.mouse.move(start!.x + 40, start!.y + 20, { steps: 5 });
    await page.mouse.move(start!.x + 80, start!.y + 40, { steps: 5 });

    mapRoute.serveWithoutMemB = true;
    await page.waitForTimeout(6000);

    // A1 — refresh arrived but re-render deferred; still 5 nodes
    await expect(page.locator('#anchor-map svg .node')).toHaveCount(5);

    // A2 — gesture still alive: further mouse move updates dragged node coords
    const mid = await circleXY(page, 'mem-a');
    expect(mid).toBeTruthy();
    await page.mouse.move(start!.x + 140, start!.y + 80, { steps: 8 });
    await page.waitForTimeout(50);
    const midAfter = await circleXY(page, 'mem-a');
    expect(midAfter).toBeTruthy();
    expect(Math.hypot(midAfter!.cx - mid!.cx, midAfter!.cy - mid!.cy)).toBeGreaterThan(1);

    await page.mouse.up();

    // A3 — deferred refresh applied; mem-b gone → 4 nodes
    await expect.poll(async () => page.locator('#anchor-map svg .node').count()).toBe(4);

    // A4 — dragged node stays where released and is pinned
    const afterUp = await circleXY(page, 'mem-a');
    expect(afterUp).toBeTruthy();
    expect(Math.abs(afterUp!.cx - midAfter!.cx)).toBeLessThan(5);
    expect(Math.abs(afterUp!.cy - midAfter!.cy)).toBeLessThan(5);
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(1);

    // A5 — pin persisted
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, LAYOUT_KEY);
    expect(stored?.agents?.default?.nodes?.['mem-a']?.pinned).toBe(true);
    expect(Math.abs(stored.agents.default.nodes['mem-a'].x - afterUp!.cx)).toBeLessThan(3);
    expect(Math.abs(stored.agents.default.nodes['mem-a'].y - afterUp!.cy)).toBeLessThan(3);

    // R4 — without drag, next poll applies immediately (restore mem-b)
    mapRoute.serveWithoutMemB = false;
    await page.waitForTimeout(5200);
    await expect.poll(async () => page.locator('#anchor-map svg .node').count()).toBe(5);
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(1);
  });
});
