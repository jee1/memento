/**
 * #998: 벡터 레인 필터 적용 통합 테스트 — 필터 절을 지우면 실패해야 한다.
 */

import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MINILM_MODEL_NAME } from '../../../../shared/config/embedding-models.js';
import { initializeDatabase } from '../../../../infrastructure/database/sqlite/init.js';
import { encodeFloat32Embedding } from '../../../../shared/utils/embedding-serialization.js';
import type { MemorySearchFilters } from '../../../../shared/types/search.types.js';
import { MemoryEmbeddingService } from '../../../embedding/services/memory-embedding-service.js';
import { buildSearchStatement } from '../../algorithms/search-engine/search-engine-sql-builder.js';
import { executeHybridQuery } from './vector-search-hybrid-query.js';
import { executeKnnQuery } from './vector-search-knn-query.js';
import { resolveRuntimeVectorContext } from './vector-search-runtime-context.js';
import type { VectorSearchExecutionOptions } from './vector-search.types.js';

const DIMENSIONS = 384;

const vecAvailable = await import('sqlite-vec').then(() => true, () => false);

function unitVector(axis: number): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[axis] = 1;
  return values;
}

function partiallyAlignedVector(axis: number, strength = 0.8): number[] {
  const values = new Array<number>(DIMENSIONS).fill(0);
  values[axis] = strength;
  values[(axis + 1) % DIMENSIONS] = Math.sqrt(1 - strength * strength);
  return values;
}

function weaklyAlignedVector(axis: number): number[] {
  return partiallyAlignedVector(axis, 0.55);
}

interface InsertOptions {
  created_at?: string;
  pinned?: number;
  tags?: string;
  privacy_scope?: string;
  importance?: number;
}

function insertMemory(
  db: Database.Database,
  id: string,
  content: string,
  vector: number[],
  options: InsertOptions = {}
): void {
  db.prepare(
    `INSERT INTO memory_item (id, type, content, importance, created_at, pinned, tags, privacy_scope)
     VALUES (?, 'semantic', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    content,
    options.importance ?? 0.5,
    options.created_at ?? '2026-05-05T01:11:07.877Z',
    options.pinned ?? 0,
    options.tags ?? '[]',
    options.privacy_scope ?? 'private'
  );
  db.prepare(
    `INSERT INTO memory_embedding
       (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
     VALUES (?, 'minilm', 'native', ?, ?, ?, ?, 32, 1, 1, 'test')`
  ).run(id, encodeFloat32Embedding(vector), DIMENSIONS, MINILM_MODEL_NAME, DIMENSIONS);
}

const queryVector = unitVector(0);
const executionOptions: VectorSearchExecutionOptions = {
  limit: 3,
  threshold: 0,
  includeContent: true,
};

function runBothLanes(
  db: Database.Database,
  filters: MemorySearchFilters,
  limit = 3
): { knnIds: string[]; hybridIds: string[] } {
  const runtimeContext = resolveRuntimeVectorContext(db, 'minilm');
  const options = { ...executionOptions, limit };
  const scope = filters;

  const knnResults = executeKnnQuery({
    db,
    effectiveQueryVector: queryVector,
    runtimeContext,
    scope,
    options,
  });
  const hybridResults = executeHybridQuery({
    db,
    effectiveQueryVector: queryVector,
    textQuery: undefined,
    runtimeContext,
    scope,
    options,
  });

  return {
    knnIds: knnResults.map(row => row.memory_id),
    hybridIds: hybridResults.map(row => row.memory_id),
  };
}

describe.skipIf(!vecAvailable)('#998 벡터 레인 필터 적용', () => {
  let db: Database.Database | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function openDb(): Promise<Database.Database> {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-filter-lanes-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));
    return db;
  }

  it('explicit supersede history keeps owner/project/privacy and deletion filters in both lanes', async (test) => {
    if (!vecAvailable) test.skip();
    const database = await openDb();
    for (const id of ['old-history', 'new-history', 'foreign-owner', 'foreign-project', 'foreign-privacy', 'deleted-history']) {
      insertMemory(database, id, 'historyneedle', unitVector(0));
    }
    database.exec(`UPDATE memory_item SET owner_id = 'a', project_id = 'p';
      UPDATE memory_item SET superseded_by = 'new-history' WHERE id = 'old-history';
      UPDATE memory_item SET owner_id = 'b' WHERE id = 'foreign-owner';
      UPDATE memory_item SET project_id = 'q' WHERE id = 'foreign-project';
      UPDATE memory_item SET privacy_scope = 'team' WHERE id = 'foreign-privacy';
      UPDATE memory_item SET is_deleted = 1 WHERE id = 'deleted-history';`);
    const filters = { include_superseded: true, owner_id: 'a', project_id: 'p', privacy_scope: ['private'] as const };
    const lanes = runBothLanes(database, { ...filters, privacy_scope: [...filters.privacy_scope] }, 4);
    expect(lanes.knnIds.sort()).toEqual(['new-history', 'old-history']);
    expect(lanes.hybridIds.sort()).toEqual(['new-history', 'old-history']);
    expect(runBothLanes(database, { ...filters, privacy_scope: [...filters.privacy_scope], include_superseded: false }, 4).knnIds).toEqual(['new-history']);
  });

  it('unfiltered KNN/hybrid keep sparse fresh top-K before LIMIT (#1552)', async () => {
    const database = await openDb();
    for (let i = 0; i < 70; i++) {
      insertMemory(database, `stale-${i}`, 'supersede needle', unitVector(0));
    }
    for (let i = 0; i < 3; i++) {
      insertMemory(database, `fresh-${i}`, 'supersede needle', partiallyAlignedVector(0));
    }
    database.prepare("UPDATE memory_item SET superseded_by = 'fresh-0' WHERE id LIKE 'stale-%'").run();
    const lanes = runBothLanes(database, {}, 3);
    expect(lanes.knnIds.sort()).toEqual(['fresh-0', 'fresh-1', 'fresh-2']);
    expect(lanes.hybridIds.sort()).toEqual(['fresh-0', 'fresh-1', 'fresh-2']);
    const hybridText = executeHybridQuery({
      db: database, effectiveQueryVector: queryVector, textQuery: 'supersede',
      runtimeContext: resolveRuntimeVectorContext(database, 'minilm'), scope: {},
      options: executionOptions,
    });
    expect(hybridText.map(row => row.memory_id).sort()).toEqual(['fresh-0', 'fresh-1', 'fresh-2']);

    const fallback = new MemoryEmbeddingService();
    const embeddings = fallback.getUnifiedEmbeddingService();
    const availableSpy = vi.spyOn(embeddings, 'isAvailable').mockReturnValue(true);
    const embeddingSpy = vi.spyOn(embeddings, 'generateEmbedding').mockResolvedValue({
      embedding: queryVector, provider: 'minilm', dimensions: DIMENSIONS, model: MINILM_MODEL_NAME,
    });
    try {
      const outcome = await fallback.searchBySimilarity(database, 'supersede', { limit: 3 });
      expect(outcome.results.map(row => row.id).sort()).toEqual(['fresh-0', 'fresh-1', 'fresh-2']);
    } finally {
      availableSpy.mockRestore();
      embeddingSpy.mockRestore();
    }

    for (const [searchQuery, preferFts] of [['supersede', true], ['supersede', false], ['', false]] as const) {
      const { sql, params } = await buildSearchStatement({
        db: database, searchQuery, preferFts, limit: 1, hasIdFilter: false,
        checkFTS5Availability: async () => true, buildFTSQuery: query => query,
        buildReflectionNotesSearchCondition: () => null,
      });
      const rows = database.prepare(sql).all(...params) as { id: string }[];
      expect(rows.map(row => row.id).sort()).toEqual(['fresh-0', 'fresh-1', 'fresh-2']);
    }
  });

  it('apply flag off에서도 매 요청의 승인·삭제·복원을 읽고 fresh top-K를 유지한다 (#1552)', async () => {
    const database = await openDb();
    insertMemory(database, 'old', 'transition needle', unitVector(0));
    insertMemory(database, 'target', 'transition needle', partiallyAlignedVector(0));
    const fallback = new MemoryEmbeddingService();
    const embeddings = fallback.getUnifiedEmbeddingService();
    const availableSpy = vi.spyOn(embeddings, 'isAvailable').mockReturnValue(true);
    const embeddingSpy = vi.spyOn(embeddings, 'generateEmbedding').mockResolvedValue({
      embedding: queryVector, provider: 'minilm', dimensions: DIMENSIONS, model: MINILM_MODEL_NAME,
    });
    vi.stubEnv('SUPERSEDE_APPLY_ENABLED', 'false');
    async function expectTop(id: string): Promise<void> {
      expect(runBothLanes(database, {}, 1)).toEqual({ knnIds: [id], hybridIds: [id] });
      const outcome = await fallback.searchBySimilarity(database, 'transition', { limit: 1 });
      expect(outcome.results.map(row => row.id)).toEqual([id]);
    }
    try {
      await expectTop('old');
      database.prepare("UPDATE memory_item SET superseded_by = 'target' WHERE id = 'old'").run();
      await expectTop('target');
      expect(runBothLanes(database, { id: ['old'] }, 1)).toEqual({ knnIds: [], hybridIds: [] });
      database.prepare("UPDATE memory_item SET is_deleted = 1 WHERE id = 'target'").run();
      await expectTop('old');
      database.prepare("UPDATE memory_item SET is_deleted = 0 WHERE id = 'target'").run();
      await expectTop('target');
      database.prepare("UPDATE memory_item SET superseded_by = NULL WHERE id = 'old'").run();
      await expectTop('old');
      database.prepare("UPDATE memory_item SET superseded_by = 'target' WHERE id = 'old'").run();
      database.prepare("DELETE FROM memory_item WHERE id = 'target'").run();
      await expectTop('old');
    } finally {
      availableSpy.mockRestore();
      embeddingSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('procedural 검색은 더 가까운 episodic 관찰·후보를 LIMIT 전에 제외한다 (#1547)', async () => {
    const database = await openDb();
    insertMemory(database, 'legacy-procedure', '기존 절차', partiallyAlignedVector(0));
    insertMemory(database, 'failure-observation', '실패 관찰', unitVector(0), { pinned: 1 });
    insertMemory(database, 'unverified-candidate', '미검증 후보', unitVector(0), { pinned: 1 });
    database.prepare("UPDATE memory_item SET type = 'procedural' WHERE id = 'legacy-procedure'").run();
    database.prepare("UPDATE memory_item SET type = 'episodic' WHERE id != 'legacy-procedure'").run();

    const procedures = runBothLanes(database, { type: ['procedural'] }, 1);
    expect(procedures.knnIds).toEqual(['legacy-procedure']);
    expect(procedures.hybridIds).toEqual(['legacy-procedure']);
    const history = runBothLanes(database, { type: ['episodic'] });
    expect(history.knnIds.sort()).toEqual(['failure-observation', 'unverified-candidate']);
    expect(history.hybridIds.sort()).toEqual(['failure-observation', 'unverified-candidate']);
  });

  it('time_from/time_to 창 안 항목만 반환한다', async () => {
    const database = await openDb();
    insertMemory(database, 'in-window', '창 안', partiallyAlignedVector(0), {
      created_at: '2026-05-05T01:15:00.000Z',
    });
    insertMemory(database, 'out-window', '창 밖', unitVector(0), {
      created_at: '2026-09-15T20:57:50.000Z',
    });

    const filters: MemorySearchFilters = {
      time_from: '2026-05-05T01:00:00Z',
      time_to: '2026-05-05T01:30:00Z',
    };
    const { knnIds, hybridIds } = runBothLanes(database, filters);

    expect(knnIds).toEqual(['in-window']);
    expect(hybridIds).toEqual(['in-window']);
  });

  it('time_from/time_to 가 오프셋·밀리초 없는 형식이어도 시간 창에 포함된다', async () => {
    const database = await openDb();
    insertMemory(database, 'iso-item', 'ISO 형식', partiallyAlignedVector(0), {
      created_at: '2025-09-23T02:10:19.000Z',
    });

    const filtersOffset: MemorySearchFilters = {
      time_from: '2025-09-23T09:00:00+09:00',
      time_to: '2025-09-24T08:59:59+09:00',
    };
    const { knnIds: knnOffset, hybridIds: hybridOffset } = runBothLanes(
      database,
      filtersOffset,
      10,
    );
    expect(knnOffset).toEqual(['iso-item']);
    expect(hybridOffset).toEqual(['iso-item']);

    const filtersNoMs: MemorySearchFilters = {
      time_from: '2025-09-23T00:00:00Z',
      time_to: '2025-09-23T23:59:59Z',
    };
    const { knnIds: knnNoMs, hybridIds: hybridNoMs } = runBothLanes(database, filtersNoMs, 10);
    expect(knnNoMs).toEqual(['iso-item']);
    expect(hybridNoMs).toEqual(['iso-item']);
  });

  it('pinned: true 이면 pinned 행만 반환한다', async () => {
    const database = await openDb();
    insertMemory(database, 'pinned-row', '핀됨', partiallyAlignedVector(0), { pinned: 1 });
    insertMemory(database, 'unpinned-row', '핀 안됨', unitVector(0), { pinned: 0 });

    const filters: MemorySearchFilters = { pinned: true };
    const { knnIds, hybridIds } = runBothLanes(database, filters);

    expect(knnIds).toEqual(['pinned-row']);
    expect(hybridIds).toEqual(['pinned-row']);
  });

  it('tags 필터는 SQL 단계에서 적용된다', async () => {
    const database = await openDb();
    insertMemory(database, 'tagged', '태그 있음', partiallyAlignedVector(0), {
      tags: '["wanted"]',
    });
    insertMemory(database, 'untagged', '태그 없음', unitVector(0), {
      tags: '[]',
    });

    const filters: MemorySearchFilters = { tags: ['wanted'] };
    const { knnIds, hybridIds } = runBothLanes(database, filters);

    expect(knnIds).toEqual(['tagged']);
    expect(hybridIds).toEqual(['tagged']);
  });

  it('privacy_scope 필터를 적용한다', async () => {
    const database = await openDb();
    insertMemory(database, 'team', '팀', partiallyAlignedVector(0), { privacy_scope: 'team' });
    insertMemory(database, 'private', '개인', unitVector(0), { privacy_scope: 'private' });

    const filters: MemorySearchFilters = { privacy_scope: ['team'] };
    const { knnIds, hybridIds } = runBothLanes(database, filters);

    expect(knnIds).toEqual(['team']);
    expect(hybridIds).toEqual(['team']);
  });

  it('importance_min/importance_max 필터를 적용한다', async () => {
    const database = await openDb();
    insertMemory(database, 'high', '높음', partiallyAlignedVector(0), { importance: 0.95 });
    insertMemory(database, 'low', '낮음', unitVector(0), { importance: 0.1 });

    const filters: MemorySearchFilters = { importance_min: 0.9, importance_max: 1 };
    const { knnIds, hybridIds } = runBothLanes(database, filters);

    expect(knnIds).toEqual(['high']);
    expect(hybridIds).toEqual(['high']);
  });

  it('후보 LIMIT 이전에 필터를 적용한다 (#736 회귀 가드)', async () => {
    const database = await openDb();
    for (let i = 0; i < 12; i += 1) {
      insertMemory(database, `unpinned-${i}`, `미핀 ${i}`, unitVector(0), { pinned: 0 });
    }
    insertMemory(database, 'pinned-a', '핀 A', weaklyAlignedVector(0), { pinned: 1 });
    insertMemory(database, 'pinned-b', '핀 B', weaklyAlignedVector(1), { pinned: 1 });

    const filters: MemorySearchFilters = { pinned: true };
    const { knnIds, hybridIds } = runBothLanes(database, filters, 3);

    expect(knnIds.sort()).toEqual(['pinned-a', 'pinned-b']);
    expect(hybridIds.sort()).toEqual(['pinned-a', 'pinned-b']);
  });

  it('latest_only 를 후보 LIMIT 전에 적용한다 (#1392)', async () => {
    const database = await openDb();
    const insert = (
      id: string,
      vector: number[],
      version: number,
      series: string
    ) => {
      database.prepare(
        `INSERT INTO memory_item (id, type, content, importance, created_at, pinned, tags, privacy_scope, version, version_series_id)
         VALUES (?, 'procedural', ?, 0.5, '2026-05-05T01:11:07.877Z', 0, '[]', 'private', ?, ?)`
      ).run(id, id, version, series);
      database.prepare(
        `INSERT INTO memory_embedding
           (memory_id, embedding_provider, projection_type, embedding, dim, model, dimensions, precision, normalized, version, created_by)
         VALUES (?, 'minilm', 'native', ?, ?, ?, ?, 32, 1, 1, 'test')`
      ).run(id, encodeFloat32Embedding(vector), DIMENSIONS, MINILM_MODEL_NAME, DIMENSIONS);
    };
    insert('mem_a_v1', unitVector(0), 1, 'series-a');
    insert('mem_a_v2', unitVector(0), 2, 'series-a');
    insert('mem_a_v3', unitVector(0), 3, 'series-a');
    insert('mem_a_v4', weaklyAlignedVector(0), 4, 'series-a');
    insert('mem_b_v1', weaklyAlignedVector(1), 1, 'series-b');

    const { knnIds, hybridIds } = runBothLanes(database, { version_filter: 'latest_only' }, 2);

    expect(knnIds).toHaveLength(2);
    expect(hybridIds).toHaveLength(2);
    expect(knnIds).toContain('mem_a_v4');
    expect(hybridIds).toContain('mem_a_v4');
    expect(knnIds).not.toContain('mem_a_v1');
    expect(knnIds).not.toContain('mem_a_v2');
    expect(knnIds).not.toContain('mem_a_v3');
    expect(hybridIds).not.toContain('mem_a_v1');
  });
});

describe('#1006 벡터 레인 메타데이터', () => {
  let db: Database.Database | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  async function openDb(): Promise<Database.Database> {
    tempDir = mkdtempSync(join(tmpdir(), 'memento-vector-metadata-'));
    db = await initializeDatabase(join(tempDir, 'memory.db'));
    return db;
  }

  it('KNN·하이브리드 레인이 DB pinned/tags 를 행별로 반환한다', async () => {
    const database = await openDb();
    insertMemory(database, 'meta-pinned', '핀+태그', partiallyAlignedVector(0), {
      pinned: 1,
      tags: '["alpha","beta"]',
    });
    insertMemory(database, 'meta-unpinned', '핀없음', partiallyAlignedVector(1), {
      pinned: 0,
      tags: '[]',
    });

    const runtimeContext = resolveRuntimeVectorContext(database, 'minilm');
    const options = { ...executionOptions, limit: 5 };

    const knnResults = executeKnnQuery({
      db: database,
      effectiveQueryVector: queryVector,
      runtimeContext,
      scope: {},
      options,
    });
    const hybridResults = executeHybridQuery({
      db: database,
      effectiveQueryVector: queryVector,
      textQuery: undefined,
      runtimeContext,
      scope: {},
      options,
    });

    for (const results of [knnResults, hybridResults]) {
      const pinnedRow = results.find((r) => r.memory_id === 'meta-pinned');
      const unpinnedRow = results.find((r) => r.memory_id === 'meta-unpinned');
      expect(pinnedRow?.pinned).toBe(true);
      expect(pinnedRow?.tags).toEqual(['alpha', 'beta']);
      expect(unpinnedRow?.pinned).toBe(false);
      expect(unpinnedRow?.tags).toEqual([]);
    }
  });
});
