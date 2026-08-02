/**
 * runAnchorAutoRefresh candidate scoring (GitHub #714).
 *
 * FIXED policy: penalize/exclude a candidate ONLY when BOTH
 *  - relation degree == 0, AND
 *  - embedding missing.
 * A candidate with a relation must never be disadvantaged solely for
 * missing an embedding (relation-first recovery, see #708/#709).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runAnchorAutoRefresh } from '../batch-scheduler-anchor-handlers.js';
import type { BatchSchedulerRunContext } from '../batch-scheduler-run-context.js';
import { AnchorManager } from '../../../../domains/anchor/services/anchor/anchor-manager.js';
import { AnchorCacheService } from '../../../../domains/anchor/services/anchor/anchor-cache-service.js';
import { AnchorSearchService } from '../../../../domains/anchor/services/anchor/anchor-search-service.js';
import { createRelationGraph } from '../../../relation-graph-factory.js';
import { setupTestDatabase, createTestMemory, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

function addRelation(db: Database.Database, sourceId: string, targetId: string): void {
  db.prepare(
    `INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES (?, ?, 'related_to')`
  ).run(sourceId, targetId);
}

function addEmbedding(db: Database.Database, memoryId: string): void {
  db.prepare(
    `INSERT INTO memory_embedding (memory_id, embedding_provider, embedding, dim)
     VALUES (?, 'tfidf', '[0.1,0.2]', 2)`
  ).run(memoryId);
}

/**
 * runAnchorAutoRefresh only refreshes agents that already have at least one
 * anchor row (it is a "refresh", not a bootstrap). Seed a stale slot A anchor
 * so all three slots (A/B/C) become eligible for re-selection in tests.
 */
function seedStaleAnchor(db: Database.Database, agentId: string, memoryId: string): void {
  db.prepare(
    `INSERT INTO anchor (agent_id, slot, memory_id, updated_at) VALUES (?, 'A', ?, '2020-01-01 00:00:00')`
  ).run(agentId, memoryId);
}

function createContext(db: Database.Database, anchorManager: AnchorManager): BatchSchedulerRunContext {
  return {
    db,
    anchorManager,
    log: vi.fn()
  } as unknown as BatchSchedulerRunContext;
}

describe('runAnchorAutoRefresh candidate scoring', () => {
  let db: Database.Database;
  let anchorManager: AnchorManager;
  const agentId = 'test-agent';

  beforeEach(async () => {
    db = await setupTestDatabase();
    const cacheService = new AnchorCacheService();
    cacheService.setDatabase(db);
    const searchService = new AnchorSearchService(cacheService);
    searchService.setDatabase(db);
    searchService.setRelationGraph(createRelationGraph(db));
    anchorManager = new AnchorManager(cacheService, searchService);
    anchorManager.setDatabase(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  it('관계도 임베딩도 없는 고립 후보는 대체 후보가 있으면 어떤 슬롯에도 선택되지 않아야 한다', async () => {
    // Given: 슬롯(A/B/C) 수(3)보다 많은 4개의 후보 중 1개만 relation/embedding이 전혀 없음
    const isolated = createTestMemory(db, { id: 'mem_isolated', content: 'isolated', importance: 0.9 });
    const connectedA = createTestMemory(db, { id: 'mem_connected_a', content: 'connected a', importance: 0.9 });
    const connectedB = createTestMemory(db, { id: 'mem_connected_b', content: 'connected b', importance: 0.9 });
    const connectedC = createTestMemory(db, { id: 'mem_connected_c', content: 'connected c', importance: 0.9 });
    addRelation(db, connectedA, connectedB);
    addEmbedding(db, connectedC);
    seedStaleAnchor(db, agentId, isolated);

    const ctx = createContext(db, anchorManager);

    // When
    const result = await runAnchorAutoRefresh(ctx);

    // Then: 고립 후보(mem_isolated)는 대체 후보가 3개(슬롯 수만큼) 있으므로 선택되지 않음
    expect(result.success).toBe(true);
    const anchors = (await anchorManager.getAnchor(agentId)) as Array<{ slot: string; memory_id: string }> | null;
    expect(anchors).not.toBeNull();
    const pickedIds = (anchors ?? []).map(a => a.memory_id);
    expect(pickedIds).not.toContain(isolated);
    expect(pickedIds.sort()).toEqual([connectedA, connectedB, connectedC].sort());
  });

  it('relation degree > 0인 후보는 embedding이 없어도 불이익받지 않아야 한다', async () => {
    // Given: relation만 있는 후보, embedding만 있는 후보, 그리고 별도 relation을 가진 후보 3개 + 고립 후보 1개
    const relationOnly = createTestMemory(db, { id: 'mem_relation_only', content: 'relation only', importance: 0.9 });
    const embeddingOnly = createTestMemory(db, { id: 'mem_embedding_only', content: 'embedding only', importance: 0.9 });
    const extraConnected = createTestMemory(db, { id: 'mem_extra_connected', content: 'extra connected', importance: 0.9 });
    const isolated = createTestMemory(db, { id: 'mem_isolated_2', content: 'isolated 2', importance: 0.95 });
    addRelation(db, relationOnly, embeddingOnly);
    addEmbedding(db, embeddingOnly);
    addRelation(db, extraConnected, relationOnly);
    seedStaleAnchor(db, agentId, isolated);

    const ctx = createContext(db, anchorManager);

    // When
    const result = await runAnchorAutoRefresh(ctx);

    // Then: relation만 있고 embedding이 없는 후보도 embedding만 있는 후보와 동등하게 선택되고,
    // relation/embedding이 모두 없는 고립 후보만 배제됨 (importance가 더 높아도)
    expect(result.success).toBe(true);
    const anchors = (await anchorManager.getAnchor(agentId)) as Array<{ slot: string; memory_id: string }> | null;
    const pickedIds = (anchors ?? []).map(a => a.memory_id);

    expect(pickedIds).toContain(relationOnly);
    expect(pickedIds).toContain(embeddingOnly);
    expect(pickedIds).toContain(extraConnected);
    expect(pickedIds).not.toContain(isolated);
  });

  it('auto-refresh가 선택한 relation-only anchor는 즉시 local search 가능해야 한다 (#725)', async () => {
    const relationOnly = createTestMemory(db, {
      id: 'mem_searchable_relation_only',
      content: 'searchable relation-only anchor',
      importance: 0.99
    });
    const neighbor = createTestMemory(db, {
      id: 'mem_searchable_neighbor',
      content: 'relation neighbor',
      importance: 0.9
    });
    const embeddingOnly = createTestMemory(db, {
      id: 'mem_searchable_embedding',
      content: 'embedding candidate',
      importance: 0.8
    });
    const stale = createTestMemory(db, {
      id: 'mem_searchable_stale',
      content: 'stale isolated anchor',
      importance: 0.1
    });
    addRelation(db, relationOnly, neighbor);
    addEmbedding(db, embeddingOnly);
    seedStaleAnchor(db, agentId, stale);

    const refreshResult = await runAnchorAutoRefresh(createContext(db, anchorManager));
    const anchorA = await anchorManager.getAnchor(agentId, 'A') as { memory_id: string } | null;
    const searchResult = await anchorManager.searchLocal(agentId, 'A', undefined, 1, { limit: 10 });

    expect(refreshResult.success).toBe(true);
    expect(anchorA?.memory_id).toBe(relationOnly);
    expect(searchResult.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: neighbor, hop_distance: 1 })
    ]));
    expect(searchResult.anchor_info?.embedding_missing).toBe(true);
  });

  it('고립 후보만 존재하면(대체 후보가 없으면) 폴백으로 여전히 앵커를 채워야 한다', async () => {
    // Given: 모든 후보가 relation/embedding 없음
    const only1 = createTestMemory(db, { id: 'mem_only_1', content: 'only 1', importance: 0.9 });
    createTestMemory(db, { id: 'mem_only_2', content: 'only 2', importance: 0.8 });
    createTestMemory(db, { id: 'mem_only_3', content: 'only 3', importance: 0.7 });
    seedStaleAnchor(db, agentId, only1);

    const ctx = createContext(db, anchorManager);

    // When
    const result = await runAnchorAutoRefresh(ctx);

    // Then: 후보가 모두 고립이어도 앵커는 정상적으로 채워짐 (예외 없음)
    expect(result.success).toBe(true);
    const anchors = (await anchorManager.getAnchor(agentId)) as Array<{ slot: string; memory_id: string }> | null;
    expect(anchors).not.toBeNull();
    expect((anchors ?? []).length).toBeGreaterThan(0);
  });

  it('고립 후보가 어쩔 수 없이 선택된 경우 isolatedPicks 메트릭을 기록해야 한다', async () => {
    // Given: 후보가 모두 고립되어 있어 고립 후보가 선택될 수밖에 없는 상황
    const metric1 = createTestMemory(db, { id: 'mem_metric_1', content: 'metric 1', importance: 0.9 });
    createTestMemory(db, { id: 'mem_metric_2', content: 'metric 2', importance: 0.8 });
    createTestMemory(db, { id: 'mem_metric_3', content: 'metric 3', importance: 0.7 });
    seedStaleAnchor(db, agentId, metric1);

    const ctx = createContext(db, anchorManager);

    // When
    const result = await runAnchorAutoRefresh(ctx);

    // Then: details에 고립 후보 선택 횟수가 기록됨
    expect(result.success).toBe(true);
    expect(result.details).toBeDefined();
    expect((result.details as { isolatedPicks: number }).isolatedPicks).toBeGreaterThan(0);
  });

  it('고립 후보를 회피할 수 있으면 isolatedPicks는 0이어야 한다', async () => {
    // Given: 대체 후보가 충분해 고립 후보를 완전히 회피 가능한 상황
    const okIsolated = createTestMemory(db, { id: 'mem_ok_isolated', content: 'isolated', importance: 0.9 });
    const a = createTestMemory(db, { id: 'mem_ok_a', content: 'a', importance: 0.9 });
    const b = createTestMemory(db, { id: 'mem_ok_b', content: 'b', importance: 0.9 });
    const c = createTestMemory(db, { id: 'mem_ok_c', content: 'c', importance: 0.9 });
    addRelation(db, a, b);
    addEmbedding(db, c);
    seedStaleAnchor(db, agentId, okIsolated);

    const ctx = createContext(db, anchorManager);

    // When
    const result = await runAnchorAutoRefresh(ctx);

    // Then
    expect(result.success).toBe(true);
    expect((result.details as { isolatedPicks: number } | undefined)?.isolatedPicks ?? 0).toBe(0);
  });

  it('LIMIT 윈도우 밖에 있는 연결 후보도 고립 후보보다 우선 선택되어야 한다 (PR #721 리뷰)', async () => {
    // Given: slot A(slotIndex 0, 이전 LIMIT=3)의 상위 importance를 모두 차지하는 고립 후보 4개
    // + LIMIT 윈도우 밖(importance 낮음)에 있는 연결 후보 1개.
    // 이전 구현은 SQL LIMIT으로 먼저 잘라낸 뒤 JS에서 연결-우선 정렬을 했기 때문에,
    // 연결 후보가 애초에 조회되지 않아 고립 후보가 선택되는 버그가 있었다.
    const isolated1 = createTestMemory(db, { id: 'mem_win_isolated_1', content: 'iso1', importance: 0.95 });
    createTestMemory(db, { id: 'mem_win_isolated_2', content: 'iso2', importance: 0.94 });
    createTestMemory(db, { id: 'mem_win_isolated_3', content: 'iso3', importance: 0.93 });
    createTestMemory(db, { id: 'mem_win_isolated_4', content: 'iso4', importance: 0.92 });
    const connected = createTestMemory(db, { id: 'mem_win_connected', content: 'connected', importance: 0.5 });
    addEmbedding(db, connected);
    seedStaleAnchor(db, agentId, isolated1);

    const ctx = createContext(db, anchorManager);

    // When
    const result = await runAnchorAutoRefresh(ctx);

    // Then: slot A는 importance가 가장 낮아도 연결된 candidate를 선택해야 한다
    expect(result.success).toBe(true);
    const anchorA = (await anchorManager.getAnchor(agentId, 'A')) as { memory_id: string } | null;
    expect(anchorA?.memory_id).toBe(connected);
  });

  it('수동 set-anchor는 relation/embedding 여부와 무관하게 그대로 동작해야 한다(비파괴)', async () => {
    // Given: relation도 embedding도 없는 메모리
    const memoryId = createTestMemory(db, { content: 'manual anchor target', importance: 0.1 });

    // When: 수동으로 앵커 설정
    await anchorManager.setAnchor(agentId, memoryId, 'A');

    // Then: 자동 스코어링과 무관하게 그대로 설정됨
    const anchor = await anchorManager.getAnchor(agentId, 'A');
    expect((anchor as { memory_id: string }).memory_id).toBe(memoryId);
  });
});
