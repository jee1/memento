import type Database from 'better-sqlite3';
import { setupTestDatabase } from '../../../../test/helpers/test-database.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countActiveMemoryItems,
  deleteExpiredWorkingMemories,
  deleteProjectMemoriesOlderThan,
  findAnchorMemorySummaryById,
  findMemoryProvenancePreviews,
  findMemoryResourceRowById,
  listActiveMemoryIdAndContent,
  listMemoryEmbeddingMapCandidates,
  listProjectMemoryCleanupCandidates,
  listRecentMemoryResourceIds,
  queryMemoryCountsByTypeStats,
  queryMemoryForgettingStatsByType,
  queryMemoryGraphNodes,
  queryProjectMemoryStats,
} from '../memory-item-repository.js';

describe('memory-item-repository query helpers (#1531)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('활성 기억의 id/content와 활성 개수를 조회한다 (soft-delete 제외)', () => {
    db.prepare(
      `INSERT INTO memory_item (id, type, content, is_deleted) VALUES
       ('m1', 'episodic', 'alpha', 0),
       ('m2', 'semantic', 'beta', 0),
       ('m3', 'working', 'deleted', 1)`,
    ).run();

    expect(countActiveMemoryItems(db)).toBe(2);
    expect(listActiveMemoryIdAndContent(db)).toEqual([
      { id: 'm1', content: 'alpha' },
      { id: 'm2', content: 'beta' },
    ]);
  });

  it('앵커 요약, provenance 미리보기, MCP 리소스 단건/목록을 조회한다', () => {
    const longContent = 'x'.repeat(300);
    db.prepare(
      `INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned, tags, source)
       VALUES
       ('m1', 'semantic', ?, 0.9, 'team', '2026-01-01T00:00:00Z', 1, '["t1"]', 'test'),
       ('m2', 'episodic', 'short', 0.4, 'private', '2026-01-02T00:00:00Z', 0, NULL, NULL)`,
    ).run(longContent);

    expect(findAnchorMemorySummaryById(db, 'm1', {})).toEqual({
      id: 'm1',
      content: longContent,
      type: 'semantic',
      importance: 0.9,
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(findAnchorMemorySummaryById(db, 'missing', {})).toBeUndefined();

    const previews = findMemoryProvenancePreviews(db, ['m2', 'm1', 'm2', 'missing']);
    expect(previews.map((row) => row.id)).toEqual(['m2', 'm1']);
    expect(previews[1]?.content_preview).toHaveLength(240);
    expect(findMemoryProvenancePreviews(db, [])).toEqual([]);

    expect(listRecentMemoryResourceIds(db, {})).toEqual([{ id: 'm2' }, { id: 'm1' }]);
    expect(findMemoryResourceRowById(db, 'm1', {})).toMatchObject({
      id: 'm1',
      type: 'semantic',
      importance: 0.9,
      privacy_scope: 'team',
    });
  });

  it('MCP 리소스와 앵커 요약은 호출자 범위 밖이나 삭제된 기억을 돌려주지 않는다', () => {
    db.prepare(
      `INSERT INTO memory_item (id, type, content, owner_id, project_id, is_deleted, created_at) VALUES
       ('own', 'semantic', 'a', 'agent-a', 'proj-1', 0, '2026-01-04T00:00:00Z'),
       ('other-owner', 'semantic', 'b', 'agent-b', 'proj-1', 0, '2026-01-03T00:00:00Z'),
       ('other-project', 'semantic', 'c', 'agent-a', 'proj-2', 0, '2026-01-02T00:00:00Z'),
       ('removed', 'semantic', 'd', 'agent-a', 'proj-1', 1, '2026-01-01T00:00:00Z')`,
    ).run();
    const bound = { owner_id: 'agent-a', project_id: 'proj-1' };

    expect(listRecentMemoryResourceIds(db, bound)).toEqual([{ id: 'own' }]);
    expect(listRecentMemoryResourceIds(db, {})).toEqual([{ id: 'own' }, { id: 'other-owner' }, { id: 'other-project' }]);
    for (const id of ['other-owner', 'other-project', 'removed']) {
      expect(findMemoryResourceRowById(db, id, bound)).toBeUndefined();
      expect(findAnchorMemorySummaryById(db, id, bound)).toBeUndefined();
    }
    expect(findMemoryResourceRowById(db, 'removed', {})).toBeUndefined();
    expect(findAnchorMemorySummaryById(db, 'removed', {})).toBeUndefined();
    expect(findMemoryResourceRowById(db, 'own', bound)?.id).toBe('own');
    expect(findAnchorMemorySummaryById(db, 'other-owner', {})?.id).toBe('other-owner');
  });

  it('임베딩 맵 후보와 그래프 노드를 필터 조건에 맞춰 조회한다', () => {
    db.prepare(
      `INSERT INTO memory_item (id, type, content, importance, created_at, pinned, is_deleted)
       VALUES
       ('m1', 'semantic', 'node-1', 0.8, '2026-01-02T00:00:00Z', 1, 0),
       ('m2', 'episodic', 'node-2', 0.6, '2026-01-01T00:00:00Z', 0, 0),
       ('m3', 'working', 'orphan', 0.3, '2026-01-03T00:00:00Z', 0, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions, model)
       VALUES ('m1', 'minilm', 'native', '[0.1,0.2]', 2, 2, 'all-MiniLM')`,
    ).run();
    db.prepare(
      `INSERT INTO memory_relation (source_id, target_id, relation_type)
       VALUES ('m1', 'm2', 'supports')`,
    ).run();

    const candidates = listMemoryEmbeddingMapCandidates(db, 'minilm', 10);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe('m1');

    const graphResult = queryMemoryGraphNodes(db, {
      exclude_orphans: true,
      relation_types: ['supports'],
      min_importance: 0.5,
      limit: 10,
    });
    expect(graphResult.totalAvailableNodes).toBe(2);
    expect(graphResult.rawNodes.map((n) => n.id)).toEqual(['m1', 'm2']);
  });

  it('프로젝트 정리는 다른 프로젝트·최근 기억·soft-delete를 보존한다', () => {
    db.exec(`INSERT INTO memory_item (id, type, content, project_id, created_at, is_deleted)
      VALUES
        ('target', 'working', 'old', 'a', datetime('now', '-40 days'), 0),
        ('other-project', 'working', 'old', 'b', datetime('now', '-40 days'), 0),
        ('other-type', 'semantic', 'old', 'a', datetime('now', '-40 days'), 0),
        ('recent', 'working', 'new', 'a', datetime('now'), 0),
        ('deleted', 'working', 'deleted', 'a', datetime('now', '-40 days'), 1)`);

    expect(queryProjectMemoryStats(db, 'a').total).toBe(3);
    expect(listProjectMemoryCleanupCandidates(db, 'a', ['working'], 30).map(row => row.id))
      .toEqual(['target']);
    expect(deleteProjectMemoriesOlderThan(db, 'a', ['working'], 30)).toBe(1);
    expect(listRecentMemoryResourceIds(db, {}).map(row => row.id).sort())
      .toEqual(['other-project', 'other-type', 'recent']);
    // MCP 리소스는 soft-delete 행을 숨긴다. provenance 경로는 이관 전처럼 읽는다.
    expect(findMemoryResourceRowById(db, 'deleted', {})).toBeUndefined();
    expect(findMemoryProvenancePreviews(db, ['deleted'])[0]?.id).toBe('deleted');
  });

  it('만료 정리는 pinned 기억을 남기고 기존 통계는 soft-delete도 센다', () => {
    db.exec(`INSERT INTO memory_item (id, type, content, pinned, created_at, is_deleted)
      VALUES
        ('expired', 'working', 'old', 0, datetime('now', '-40 days'), 0),
        ('pinned', 'working', 'pinned', 1, datetime('now', '-40 days'), 0),
        ('deleted', 'semantic', 'deleted', 0, datetime('now', '-40 days'), 1)`);

    expect(queryMemoryCountsByTypeStats(db)?.total_memories).toBe(3);
    expect(queryMemoryForgettingStatsByType(db)).toContainEqual({
      type: 'working', total_count: 2, pinned_count: 1, old_count: 2,
    });
    expect(deleteExpiredWorkingMemories(db)).toBe(1);
    expect(findMemoryResourceRowById(db, 'pinned', {})?.pinned).toBe(1);
    expect(findMemoryResourceRowById(db, 'deleted', {})).toBeUndefined();
  });

  it('프로젝트별 통계/정리 및 만료·망각·성능 통계를 집계한다', () => {
    db.prepare(
      `INSERT INTO memory_item (id, type, content, project_id, pinned, created_at, is_deleted)
       VALUES
       ('p1', 'working', 'old working', 'proj-a', 0, datetime('now', '-10 days'), 0),
       ('p2', 'episodic', 'old episodic', 'proj-a', 1, datetime('now', '-40 days'), 0),
       ('p3', 'semantic', 'recent semantic', 'proj-a', 0, datetime('now', '-1 days'), 0)`,
    ).run();

    const projectStats = queryProjectMemoryStats(db, 'proj-a');
    expect(projectStats.total).toBe(3);
    expect(projectStats.by_type).toEqual({
      working: 1,
      episodic: 1,
      semantic: 1,
    });

    const preview = listProjectMemoryCleanupCandidates(db, 'proj-a', ['working'], 5);
    expect(preview.map((r) => r.id)).toEqual(['p1']);

    const forgettingByType = queryMemoryForgettingStatsByType(db);
    expect(forgettingByType).toHaveLength(3);

    const counts = queryMemoryCountsByTypeStats(db);
    expect(counts).toEqual({
      total_memories: 3,
      working_memories: 1,
      episodic_memories: 1,
      semantic_memories: 1,
      procedural_memories: 0,
      pinned_memories: 1,
    });

    expect(deleteExpiredWorkingMemories(db)).toBe(1);
    expect(deleteProjectMemoriesOlderThan(db, 'proj-a', ['episodic'], 30)).toBe(1);
  });
});
