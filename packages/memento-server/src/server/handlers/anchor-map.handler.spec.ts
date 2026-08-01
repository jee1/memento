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
  predecessor_id?: string;
  predecessor_ids?: string[];
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

describe('buildAnchorMapData - hop 2/3 path edges (#715)', () => {
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

  const noRelations = {
    getRelationsBatch: vi.fn().mockResolvedValue(new Map()),
  } as unknown as ServerServices['relationGraph'];

  it('2-hop fixture anchor→m1→m2에서 실제 경로 edge 2개가 생성되고, anchor→m2 직결 edge는 생성되지 않아야 함', async () => {
    insertMemory('anchor-a');
    insertMemory('m1');
    insertMemory('m2');

    const anchorManager = buildFakeAnchorManager(
      [{ agent_id: 'default', slot: 'B', memory_id: 'anchor-a', created_at: 'now', updated_at: 'now' }],
      {
        B: [
          { id: 'm1', content: 'hop1', type: 'episodic', hop_distance: 1, similarity: 0.8, predecessor_id: 'anchor-a' } as FakeSearchItem,
          { id: 'm2', content: 'hop2', type: 'episodic', hop_distance: 2, similarity: 0.6, predecessor_id: 'm1' } as FakeSearchItem,
        ],
      }
    );

    const serverServices = { anchorManager, relationGraph: noRelations } as unknown as ServerServices;

    const result = await buildAnchorMapData(db, serverServices, 'default');

    expect(result.nodes.map(n => n.id).sort()).toEqual(['anchor-a', 'm1', 'm2']);

    const hopEdges = result.links.filter(l => l.type === 'hop');
    expect(hopEdges).toHaveLength(2);
    expect(hopEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'anchor-a', target: 'm1', hop_distance: 1 }),
        expect.objectContaining({ source: 'm1', target: 'm2', hop_distance: 2 }),
      ])
    );

    // 존재하지 않는 anchor→m2 직결 edge가 생성되지 않아야 함
    expect(hopEdges.find(l => l.source === 'anchor-a' && l.target === 'm2')).toBeUndefined();
  });

  it('predecessor_id가 map에 없는 노드를 가리키면 hop≥2 edge와 노드 모두 생성하지 않아야 함 (경로 폐쇄성, #715 MEDIUM#2)', async () => {
    insertMemory('anchor-a');
    insertMemory('m2');

    const anchorManager = buildFakeAnchorManager(
      [{ agent_id: 'default', slot: 'B', memory_id: 'anchor-a', created_at: 'now', updated_at: 'now' }],
      {
        // m1(predecessor)이 결과에서 필터링되어 빠지고 m2만 남은 경우
        B: [
          { id: 'm2', content: 'hop2', type: 'episodic', hop_distance: 2, similarity: 0.6, predecessor_id: 'm1' } as FakeSearchItem,
        ],
      }
    );

    const serverServices = { anchorManager, relationGraph: noRelations } as unknown as ServerServices;

    const result = await buildAnchorMapData(db, serverServices, 'default');

    expect(result.links.filter(l => l.type === 'hop')).toHaveLength(0);
    // 경로가 끊긴 hop≥2 노드는 부유(floating) 상태로 지도에 남지 않아야 함
    expect(result.nodes.find(n => n.id === 'm2')).toBeUndefined();
  });

  it('anchor→m1→x, anchor→m2→x처럼 두 경로가 같은 메모리로 합류하면 노드는 1개, edge는 2개 보존되어야 함 (#715 MEDIUM#1)', async () => {
    insertMemory('anchor-a');
    insertMemory('m1');
    insertMemory('m2');
    insertMemory('x');

    const anchorManager = buildFakeAnchorManager(
      [{ agent_id: 'default', slot: 'B', memory_id: 'anchor-a', created_at: 'now', updated_at: 'now' }],
      {
        B: [
          { id: 'm1', content: 'hop1-a', type: 'episodic', hop_distance: 1, similarity: 0.8, predecessor_id: 'anchor-a' } as FakeSearchItem,
          { id: 'm2', content: 'hop1-b', type: 'episodic', hop_distance: 1, similarity: 0.75, predecessor_id: 'anchor-a' } as FakeSearchItem,
          {
            id: 'x',
            content: 'hop2-shared',
            type: 'episodic',
            hop_distance: 2,
            similarity: 0.6,
            predecessor_id: 'm1',
            predecessor_ids: ['m1', 'm2'],
          } as FakeSearchItem,
        ],
      }
    );

    const serverServices = { anchorManager, relationGraph: noRelations } as unknown as ServerServices;

    const result = await buildAnchorMapData(db, serverServices, 'default');

    const xNodes = result.nodes.filter(n => n.id === 'x');
    expect(xNodes).toHaveLength(1);

    const xEdges = result.links.filter(l => l.type === 'hop' && l.target === 'x');
    expect(xEdges).toHaveLength(2);
    expect(xEdges.map(l => l.source).sort()).toEqual(['m1', 'm2']);
  });

  it('hop 결과 배열 순서가 hop 오름차순이 아니어도(hop2가 먼저 와도) 경로 edge를 올바르게 연결해야 함', async () => {
    insertMemory('anchor-a');
    insertMemory('m1');
    insertMemory('m2');

    const anchorManager = buildFakeAnchorManager(
      [{ agent_id: 'default', slot: 'B', memory_id: 'anchor-a', created_at: 'now', updated_at: 'now' }],
      {
        // m2(hop2)가 m1(hop1)보다 먼저 배열에 위치 (랭킹 정렬로 인해 hop 순서가 아닐 수 있음)
        B: [
          { id: 'm2', content: 'hop2', type: 'episodic', hop_distance: 2, similarity: 0.9, predecessor_id: 'm1' } as FakeSearchItem,
          { id: 'm1', content: 'hop1', type: 'episodic', hop_distance: 1, similarity: 0.5, predecessor_id: 'anchor-a' } as FakeSearchItem,
        ],
      }
    );

    const serverServices = { anchorManager, relationGraph: noRelations } as unknown as ServerServices;

    const result = await buildAnchorMapData(db, serverServices, 'default');

    const hopEdges = result.links.filter(l => l.type === 'hop');
    expect(hopEdges).toHaveLength(2);
    expect(hopEdges.find(l => l.source === 'm1' && l.target === 'm2')).toBeDefined();
  });
});
