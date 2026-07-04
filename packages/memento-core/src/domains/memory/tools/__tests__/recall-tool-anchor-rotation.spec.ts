import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { AnchorCacheService } from '../../../anchor/services/anchor/anchor-cache-service.js';
import { AnchorManager } from '../../../anchor/services/anchor/anchor-manager.js';
import { AnchorSearchService } from '../../../anchor/services/anchor/anchor-search-service.js';
import type { ToolContext } from '../../../tools/types.js';
import { handleAutoSetAnchor } from '../recall-tool-anchor-rotation.js';
import type { RecallToolHost } from '../recall-tool-host.js';

function createAnchorTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anchor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      slot TEXT CHECK (slot IN ('A', 'B', 'C')) NOT NULL,
      memory_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, slot)
    );
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      pinned BOOLEAN DEFAULT FALSE,
      deleted_at TEXT
    );
  `);
}

describe('handleAutoSetAnchor', () => {
  let db: Database.Database;
  let anchorManager: AnchorManager;
  let context: ToolContext;
  const host: RecallToolHost = {
    logInfo: () => undefined,
    logWarning: () => undefined,
    logError: () => undefined,
    validateService: <T>(service: T | undefined) => service as T,
    createSuccessResult: (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
  };

  beforeEach(async () => {
    db = new Database(':memory:');
    createAnchorTable(db);
    const cacheService = new AnchorCacheService();
    const searchService = new AnchorSearchService(db, cacheService);
    anchorManager = new AnchorManager(cacheService, searchService, { db });
    context = {
      db,
      services: { anchorManager },
    };
  });

  afterEach(() => {
    db.close();
  });

  it('given: 슬롯 A/B/C가 모두 차 있고 검색 1위가 슬롯 A와 동일, when: auto_set_anchor, then: 오류 없이 no-op', async () => {
    const agentId = 'default';
    const memoryA = 'mem_a';
    const memoryB = 'mem_b';
    const memoryC = 'mem_c';

    for (const [id, content] of [
      [memoryA, 'A'],
      [memoryB, 'B'],
      [memoryC, 'C'],
    ] as const) {
      db.prepare('INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)').run(id, 'episodic', content);
    }

    await anchorManager.setAnchor(agentId, memoryA, 'A');
    await anchorManager.setAnchor(agentId, memoryB, 'B');
    await anchorManager.setAnchor(agentId, memoryC, 'C');

    const result = await handleAutoSetAnchor(
      host,
      [{ id: memoryA, memory_id: memoryA }],
      agentId,
      context
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.anchor_set).toEqual({ memory_id: memoryA, slot: 'A', agent_id: agentId });

    const slots = db.prepare('SELECT slot, memory_id FROM anchor WHERE agent_id = ? ORDER BY slot')
      .all(agentId) as Array<{ slot: string; memory_id: string }>;
    expect(slots).toEqual([
      { slot: 'A', memory_id: memoryA },
      { slot: 'B', memory_id: memoryB },
      { slot: 'C', memory_id: memoryC },
    ]);
  });

  it('given: 슬롯 A/B/C가 모두 차 있고 검색 1위가 새 기억, when: auto_set_anchor, then: A→B→C 회전', async () => {
    const agentId = 'default';
    const memoryA = 'mem_a';
    const memoryB = 'mem_b';
    const memoryC = 'mem_c';
    const memoryNew = 'mem_new';

    for (const [id, content] of [
      [memoryA, 'A'],
      [memoryB, 'B'],
      [memoryC, 'C'],
      [memoryNew, 'NEW'],
    ] as const) {
      db.prepare('INSERT INTO memory_item (id, type, content) VALUES (?, ?, ?)').run(id, 'episodic', content);
    }

    await anchorManager.setAnchor(agentId, memoryA, 'A');
    await anchorManager.setAnchor(agentId, memoryB, 'B');
    await anchorManager.setAnchor(agentId, memoryC, 'C');

    const result = await handleAutoSetAnchor(
      host,
      [{ id: memoryNew, memory_id: memoryNew }],
      agentId,
      context
    );

    expect(result.success).toBe(true);
    expect(result.anchor_set?.memory_id).toBe(memoryNew);

    const slotA = db.prepare('SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = ?')
      .get(agentId, 'A') as { memory_id: string };
    const slotB = db.prepare('SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = ?')
      .get(agentId, 'B') as { memory_id: string };
    const slotC = db.prepare('SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = ?')
      .get(agentId, 'C') as { memory_id: string };

    expect(slotA.memory_id).toBe(memoryNew);
    expect(slotB.memory_id).toBe(memoryA);
    expect(slotC.memory_id).toBe(memoryB);
  });
});
