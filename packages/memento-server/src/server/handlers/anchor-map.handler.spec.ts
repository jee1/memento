import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { listAnchorAgentIds, buildAnchorMapData } from './anchor-map.handler.js';
import type { ServerServices } from '../bootstrap.js';

function createAnchorSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE anchor (
      agent_id TEXT NOT NULL,
      slot TEXT NOT NULL CHECK (slot IN ('A', 'B', 'C')),
      memory_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, slot)
    );
  `);
}

describe('listAnchorAgentIds', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createAnchorSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array when no anchors have memory_id set', () => {
    db.prepare(`
      INSERT INTO anchor (agent_id, slot, memory_id)
      VALUES ('default', 'A', NULL)
    `).run();

    expect(listAnchorAgentIds(db)).toEqual([]);
  });

  it('groups anchors by agent_id and counts only rows with memory_id', () => {
    db.prepare(`
      INSERT INTO anchor (agent_id, slot, memory_id) VALUES
        ('agent-a', 'A', 'mem-1'),
        ('agent-a', 'B', 'mem-2'),
        ('agent-b', 'A', 'mem-3'),
        ('agent-b', 'C', NULL)
    `).run();

    expect(listAnchorAgentIds(db)).toEqual([
      { agent_id: 'agent-a', anchor_count: 2 },
      { agent_id: 'agent-b', anchor_count: 1 },
    ]);
  });

  it('orders results by agent_id ascending', () => {
    db.prepare(`
      INSERT INTO anchor (agent_id, slot, memory_id) VALUES
        ('zebra', 'A', 'mem-z'),
        ('alpha', 'A', 'mem-a'),
        ('middle', 'A', 'mem-m')
    `).run();

    expect(listAnchorAgentIds(db).map(entry => entry.agent_id)).toEqual([
      'alpha',
      'middle',
      'zebra',
    ]);
  });
});

function createMemoryItemSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

type FakeSearchItem = {
  id: string;
  content: string;
  type: string;
  similarity?: number;
  hop_distance?: number;
  importance?: number;
  created_at?: string;
};

function buildFakeAnchorManager(
  anchors: Array<{ agent_id: string; slot: string; memory_id: string | null; created_at: string; updated_at: string }>,
  searchResultsBySlot: Record<string, FakeSearchItem[]>
): ServerServices['anchorManager'] {
  return {
    getAnchor: vi.fn().mockResolvedValue(anchors),
    getSlotConfig: vi.fn().mockReturnValue({ hop_limit: 1, vector_threshold: 0.5 }),
    searchLocal: vi.fn().mockImplementation(async (_agentId: string, slot: string) => ({
      items: searchResultsBySlot[slot] ?? [],
      total_count: (searchResultsBySlot[slot] ?? []).length,
      local_results_count: (searchResultsBySlot[slot] ?? []).length,
      fallback_used: false,
      query_time: 0,
    })),
  } as unknown as ServerServices['anchorManager'];
}

describe('buildAnchorMapData - anchor map network edges (#709)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createMemoryItemSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  function insertMemory(id: string, content = `content-${id}`): void {
    db.prepare(
      `INSERT INTO memory_item (id, content, type, importance, created_at) VALUES (?, ?, 'episodic', 0.5, datetime('now'))`
    ).run(id, content);
  }

  it('same memory found by slot A and slot B search produces 1 node and 2 slot edges', async () => {
    insertMemory('anchor-a');
    insertMemory('anchor-b');
    insertMemory('mem-shared');

    const anchorManager = buildFakeAnchorManager(
      [
        { agent_id: 'default', slot: 'A', memory_id: 'anchor-a', created_at: 'now', updated_at: 'now' },
        { agent_id: 'default', slot: 'B', memory_id: 'anchor-b', created_at: 'now', updated_at: 'now' },
      ],
      {
        A: [{ id: 'mem-shared', content: 'shared', type: 'episodic', hop_distance: 1, similarity: 0.8 }],
        B: [{ id: 'mem-shared', content: 'shared', type: 'episodic', hop_distance: 1, similarity: 0.6 }],
      }
    );

    const relationGraph = {
      getRelationsBatch: vi.fn().mockResolvedValue(new Map()),
    } as unknown as ServerServices['relationGraph'];

    const serverServices = { anchorManager, relationGraph } as unknown as ServerServices;

    const result = await buildAnchorMapData(db, serverServices, 'default');

    const sharedNodes = result.nodes.filter(n => n.id === 'mem-shared');
    expect(sharedNodes).toHaveLength(1);

    const slotEdges = result.links.filter(l => l.type === 'hop' && l.target === 'mem-shared');
    expect(slotEdges).toHaveLength(2);
    expect(slotEdges.map(l => l.source).sort()).toEqual(['anchor-a', 'anchor-b']);
  });

  it('builds relation-based edges via RelationGraph.getRelationsBatch with confidence as weight (memory_link not queried)', async () => {
    insertMemory('anchor-a');
    insertMemory('mem-neighbor');

    const anchorManager = buildFakeAnchorManager(
      [{ agent_id: 'default', slot: 'A', memory_id: 'anchor-a', created_at: 'now', updated_at: 'now' }],
      { A: [{ id: 'mem-neighbor', content: 'neighbor', type: 'episodic', hop_distance: 1, similarity: 0.7 }] }
    );

    const relationRow = {
      id: 1,
      source_id: 'anchor-a',
      target_id: 'mem-neighbor',
      relation_type: 'REFERENCES',
      confidence: 0.42,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const getRelationsBatch = vi.fn().mockResolvedValue(
      new Map([
        ['anchor-a', [relationRow]],
        ['mem-neighbor', [relationRow]],
      ])
    );
    const relationGraph = { getRelationsBatch } as unknown as ServerServices['relationGraph'];

    const serverServices = { anchorManager, relationGraph } as unknown as ServerServices;

    const result = await buildAnchorMapData(db, serverServices, 'default');

    expect(getRelationsBatch).toHaveBeenCalledWith(
      expect.arrayContaining(['anchor-a', 'mem-neighbor']),
      { direction: 'both' }
    );

    const relationLinks = result.links.filter(l => l.type === 'link');
    expect(relationLinks).toHaveLength(1);
    expect(relationLinks[0]).toMatchObject({
      source: 'anchor-a',
      target: 'mem-neighbor',
      similarity: 0.42,
    });
  });

  it('ignores relations pointing to memories that are not part of the current node set (floating hop>=2 excluded)', async () => {
    insertMemory('anchor-a');
    insertMemory('mem-neighbor');

    const anchorManager = buildFakeAnchorManager(
      [{ agent_id: 'default', slot: 'A', memory_id: 'anchor-a', created_at: 'now', updated_at: 'now' }],
      { A: [{ id: 'mem-neighbor', content: 'neighbor', type: 'episodic', hop_distance: 1, similarity: 0.7 }] }
    );

    const relationToOutsideNode = {
      id: 2,
      source_id: 'anchor-a',
      target_id: 'mem-not-on-map',
      relation_type: 'REFERENCES',
      confidence: 0.9,
      created_at: new Date(),
      updated_at: new Date(),
    };
    const getRelationsBatch = vi.fn().mockResolvedValue(
      new Map([
        ['anchor-a', [relationToOutsideNode]],
        ['mem-neighbor', []],
      ])
    );
    const relationGraph = { getRelationsBatch } as unknown as ServerServices['relationGraph'];

    const serverServices = { anchorManager, relationGraph } as unknown as ServerServices;

    const result = await buildAnchorMapData(db, serverServices, 'default');

    expect(result.links.filter(l => l.type === 'link')).toHaveLength(0);
    expect(result.nodes.find(n => n.id === 'mem-not-on-map')).toBeUndefined();
  });
});
