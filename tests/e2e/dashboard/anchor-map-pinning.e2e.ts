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

async function dragNodeById(page: Page, id: string, mapX: number, mapY: number) {
  const index = await page.evaluate((nodeId) => {
    return [...document.querySelectorAll('#anchor-map svg circle.node')]
      .findIndex((c) => (c as SVGElement & { __data__?: { id?: string } }).__data__?.id === nodeId);
  }, id);
  if (index < 0) throw new Error('node not found: ' + id);

  await page.locator('#anchor-map svg circle.node').nth(index).dragTo(page.locator('#anchor-map'), {
    targetPosition: { x: mapX, y: mapY },
    force: true,
  });
}

async function waitSim(page: Page, ms: number, freeId = 'mem-b') {
  const freeBefore = freeId ? await circleXY(page, freeId) : null;
  await page.waitForTimeout(ms);
  if (!freeId || !freeBefore) return true;
  const freeAfter = await circleXY(page, freeId);
  return Boolean(freeAfter && Math.hypot(freeAfter.cx - freeBefore.cx, freeAfter.cy - freeBefore.cy) >= 1);
}

test.describe('Anchor Map pinning (real d3)', () => {
  // Shared mutable flag for auto-refresh payload swap (avoid unroute races).
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

    // Clear storage once before the first document load (not on later reload).
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('memento.e2e.storageSeeded') === '1') return;
        localStorage.clear();
        sessionStorage.setItem('memento.e2e.storageSeeded', '1');
      } catch (_err) { /* ignore */ }
    });
  });

  test('pins dragged nodes, keeps them after 5s, restores after refresh, and supports manual controls', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/dashboard');
    await expect(page.locator('#anchor-map svg .node')).toHaveCount(5);
    // Let force simulation place nodes before dragging.
    await page.waitForTimeout(800);

    // E1 — drag mem-a near map-relative (600, 300)
    await dragNodeById(page, 'mem-a', 600, 300);
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(1);
    const afterDrag = await circleXY(page, 'mem-a');
    expect(afterDrag).toBeTruthy();
    expect(Math.abs(afterDrag!.cx - 600)).toBeLessThan(30);
    expect(Math.abs(afterDrag!.cy - 300)).toBeLessThan(30);
    await expect(page.locator('#anchor-map svg .node-label').filter({ hasText: '📌' })).toHaveCount(1);

    // E2 — hold 5s; free control node must move
    const pinnedBefore = await circleXY(page, 'mem-a');
    const freeMoved = await waitSim(page, 5200, 'mem-b');
    const pinnedAfter = await circleXY(page, 'mem-a');
    expect(Math.abs(pinnedAfter!.cx - pinnedBefore!.cx)).toBeLessThan(1);
    expect(Math.abs(pinnedAfter!.cy - pinnedBefore!.cy)).toBeLessThan(1);
    expect(freeMoved).toBe(true);

    // E3 — localStorage
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, LAYOUT_KEY);
    expect(stored?.version).toBe(1);
    expect(stored?.agents?.default?.nodes?.['mem-a']?.pinned).toBe(true);
    expect(Math.abs(stored.agents.default.nodes['mem-a'].x - pinnedAfter!.cx)).toBeLessThan(3);
    expect(Math.abs(stored.agents.default.nodes['mem-a'].y - pinnedAfter!.cy)).toBeLessThan(3);

    // E4 — auto-refresh drops mem-b, keeps mem-a pin
    mapRoute.serveWithoutMemB = true;
    await page.locator('#refresh-interval-select').selectOption('5000');
    await page.locator('#auto-refresh-toggle').check();
    await page.waitForTimeout(5200);
    await expect.poll(async () => page.locator('#anchor-map svg .node').count()).toBe(4);
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(1);
    const afterRefresh = await circleXY(page, 'mem-a');
    expect(Math.abs(afterRefresh!.cx - pinnedAfter!.cx)).toBeLessThan(1);
    const storedAfterDrop = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), LAYOUT_KEY);
    expect(storedAfterDrop.agents?.default?.nodes?.['mem-b']).toBeUndefined();

    // E5 — renderMap path (WS equivalent)
    await page.evaluate((payload) => {
      const ns = (window as unknown as { __MEMENTO_ANCHOR_MAP__: {
        state: { mapData: unknown };
        renderMap: () => void;
      } }).__MEMENTO_ANCHOR_MAP__;
      ns.state.mapData = payload;
      ns.renderMap();
    }, {
      ...mapPayload,
      nodes: mapPayload.nodes.filter((n) => n.id !== 'mem-b'),
      links: mapPayload.links.filter((l) => l.target !== 'mem-b'),
    });
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(1);
    const afterWs = await circleXY(page, 'mem-a');
    expect(Math.abs(afterWs!.cx - pinnedAfter!.cx)).toBeLessThan(1);

    // E6 — reload restores pin
    mapRoute.serveWithoutMemB = false;
    const storedBeforeReload = await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY);
    expect(storedBeforeReload).toBeTruthy();
    await page.reload();
    await expect(page.locator('#anchor-map svg .node')).toHaveCount(5);
    const storedAfterReload = await page.evaluate((key) => localStorage.getItem(key), LAYOUT_KEY);
    expect(storedAfterReload).toBe(storedBeforeReload);
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(1);
    const afterReload = await circleXY(page, 'mem-a');
    expect(Math.abs(afterReload!.cx - stored.agents.default.nodes['mem-a'].x)).toBeLessThan(3);

    // E7 — unpin via detail panel
    await page.evaluate(() => {
      const ns = (window as unknown as { __MEMENTO_ANCHOR_MAP__: {
        state: { nodes: Array<{ id: string }> };
        selectNode: (n: unknown) => void;
      } }).__MEMENTO_ANCHOR_MAP__;
      const node = ns.state.nodes.find((n) => n.id === 'mem-a');
      if (node) ns.selectNode(node);
    });
    const unpinStart = await circleXY(page, 'mem-a');
    await page.locator('#memory-details .js-unpin-node').click();
    await page.waitForTimeout(3200);
    const freeCheck = await circleXY(page, 'mem-a');
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(0);
    expect(Math.hypot(freeCheck!.cx - unpinStart!.cx, freeCheck!.cy - unpinStart!.cy)).toBeGreaterThanOrEqual(1);
    const storedUnpinned = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), LAYOUT_KEY);
    expect(storedUnpinned.agents?.default?.nodes?.['mem-a']).toBeUndefined();

    // E8 — unpin all
    await page.waitForTimeout(400);
    await dragNodeById(page, 'mem-a', 600, 300);
    await dragNodeById(page, 'anchor-b', 500, 200);
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(2);
    const pinA = await circleXY(page, 'mem-a');
    const pinB = await circleXY(page, 'anchor-b');
    await page.locator('#unpin-all-btn').click();
    await page.waitForTimeout(3200);
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(0);
    const aNow = await circleXY(page, 'mem-a');
    const bNow = await circleXY(page, 'anchor-b');
    expect(Math.hypot(aNow!.cx - pinA!.cx, aNow!.cy - pinA!.cy)).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(bNow!.cx - pinB!.cx, bNow!.cy - pinB!.cy)).toBeGreaterThanOrEqual(1);

    // E9 — pause layout: no movement
    await page.locator('#layout-mode-btn').click();
    await expect(page.locator('#layout-mode-btn')).toHaveText('자동 정렬');
    await expect(page.locator('#layout-mode-btn')).toHaveAttribute('aria-pressed', 'true');
    const pausedSnapshot = await page.evaluate(() =>
      [...document.querySelectorAll('#anchor-map svg circle.node')].map((c) => ({
        id: (c as SVGElement & { __data__?: { id?: string } }).__data__?.id,
        cx: parseFloat(c.getAttribute('cx') || '0'),
        cy: parseFloat(c.getAttribute('cy') || '0'),
      })),
    );
    await page.waitForTimeout(5200);
    const pausedAfter = await page.evaluate(() =>
      [...document.querySelectorAll('#anchor-map svg circle.node')].map((c) => ({
        id: (c as SVGElement & { __data__?: { id?: string } }).__data__?.id,
        cx: parseFloat(c.getAttribute('cx') || '0'),
        cy: parseFloat(c.getAttribute('cy') || '0'),
      })),
    );
    for (const before of pausedSnapshot) {
      const after = pausedAfter.find((n) => n.id === before.id);
      expect(Math.abs(after!.cx - before.cx)).toBeLessThan(1);
      expect(Math.abs(after!.cy - before.cy)).toBeLessThan(1);
    }

    // E10 — drag while paused still follows and pins
    await dragNodeById(page, 'mem-a', 450, 250);
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(1);
    const pausedPin = await circleXY(page, 'mem-a');
    await page.waitForTimeout(1000);
    const pausedPinAfter = await circleXY(page, 'mem-a');
    expect(Math.abs(pausedPinAfter!.cx - pausedPin!.cx)).toBeLessThan(1);

    // E11 — reset layout
    await page.locator('#layout-reset-btn').click();
    const afterResetStore = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    }, LAYOUT_KEY);
    expect(afterResetStore?.agents?.default).toBeFalsy();
    await expect(page.locator('#anchor-map svg .node.pinned')).toHaveCount(0);
    const resetBefore = await circleXY(page, 'mem-a');
    await page.waitForTimeout(3200);
    const resetAfter = await circleXY(page, 'mem-a');
    expect(Math.hypot(resetAfter!.cx - resetBefore!.cx, resetAfter!.cy - resetBefore!.cy)).toBeGreaterThanOrEqual(1);
  });
});
