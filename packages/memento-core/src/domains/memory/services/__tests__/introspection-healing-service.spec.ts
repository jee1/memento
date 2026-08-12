/**
 * Introspection Healing Service 테스트 (Issue #728)
 *
 * Given/When/Then: 저신뢰·고실패 스캔 결과를 re-embed/demote/soft-delete/review로
 * 분류하고, dry-run이 DB를 바꾸지 않으며 apply가 각 액션을 정확히 실행하는지 검증.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { IntrospectionHealingService } from '../introspection-healing-service.js';
import { MetaMemoryStatsSchemaMigration } from '../../../../infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryForgettingEventMigration } from '../../../../infrastructure/database/database/migration/migrations/037-memory-forgetting-event.js';

const PROVIDER = 'minilm';
const EXPECTED_DIM = 384;

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    );
    CREATE TABLE memory_embedding (
      memory_id TEXT NOT NULL, embedding_provider TEXT NOT NULL, projection_type TEXT NOT NULL,
      embedding TEXT NOT NULL, dim INTEGER NOT NULL, dimensions INTEGER, model TEXT, created_by TEXT, created_at TEXT,
      UNIQUE(memory_id, embedding_provider, projection_type)
    );
  `);
}

function insertMemory(
  db: Database.Database,
  id: string,
  opts: { importance: number; pinned?: boolean; avgConfidence: number; failureCount: number; hasEmbedding?: boolean },
): void {
  db.prepare(
    `INSERT INTO memory_item (id, type, content, importance, pinned) VALUES (?, 'episodic', ?, ?, ?)`,
  ).run(id, `content of ${id}`, opts.importance, opts.pinned ? 1 : 0);
  db.prepare(
    `INSERT INTO meta_memory_stats (memory_id, recall_count, success_count, failure_count, avg_confidence, created_at, updated_at)
     VALUES (?, 10, 5, ?, ?, datetime('now'), datetime('now'))`,
  ).run(id, opts.failureCount, opts.avgConfidence);
  if (opts.hasEmbedding !== false) {
    db.prepare(
      `INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions)
       VALUES (?, ?, 'native', '[]', ?, ?)`,
    ).run(id, PROVIDER, EXPECTED_DIM, EXPECTED_DIM);
  }
}

function fakeEmbeddingService() {
  return {
    isAvailable: () => true,
    createAndStoreEmbedding: vi.fn().mockImplementation(async (dbArg: Database.Database, memoryId: string) => {
      dbArg.prepare(
        `INSERT OR REPLACE INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions)
         VALUES (?, ?, 'native', '[]', ?, ?)`,
      ).run(memoryId, PROVIDER, EXPECTED_DIM, EXPECTED_DIM);
      return { provider: PROVIDER, embedding: Array(EXPECTED_DIM).fill(0) };
    }),
  };
}

describe('IntrospectionHealingService', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    createSchema(db);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryForgettingEventMigration().up(db);

    // re-embed 대상: 저신뢰 + provider 임베딩 없음
    insertMemory(db, 'mem_reembed', { importance: 0.5, avgConfidence: 0.3, failureCount: 0, hasEmbedding: false });
    // review 대상: 고실패지만 pinned → 자동 조치 제외
    insertMemory(db, 'mem_pinned', { importance: 0.5, pinned: true, avgConfidence: 0.9, failureCount: 5 });
    // soft-delete 대상: 고실패 + 비핀 + importance < 0.3
    insertMemory(db, 'mem_softdelete', { importance: 0.2, avgConfidence: 0.9, failureCount: 5 });
    // demote 대상: 저신뢰, importance > floor(0.1)
    insertMemory(db, 'mem_demote', { importance: 0.5, avgConfidence: 0.3, failureCount: 0 });
    // review 대상: 저신뢰지만 이미 importance == floor(0.1)
    insertMemory(db, 'mem_floor', { importance: 0.1, avgConfidence: 0.3, failureCount: 0 });
    // union dedup 대상: 저신뢰 AND 고실패 둘 다 해당, importance 높아 soft-delete 임계 미달 → demote 1회만
    insertMemory(db, 'mem_both', { importance: 0.5, avgConfidence: 0.3, failureCount: 5 });
    // 정상 메모리: union에 포함되면 안 됨
    insertMemory(db, 'mem_ok', { importance: 0.7, avgConfidence: 0.9, failureCount: 0 });
  });

  afterEach(() => db.close());

  it('dry-run(기본값)은 DB를 전혀 바꾸지 않아야 함', async () => {
    const before = db.prepare('SELECT id, importance, is_deleted FROM memory_item ORDER BY id').all();
    const beforeEmbeddingCount = (db.prepare('SELECT COUNT(*) as c FROM memory_embedding').get() as { c: number }).c;

    const embeddingService = fakeEmbeddingService();
    const service = new IntrospectionHealingService(db, embeddingService as any);
    const result = await service.heal({ provider: PROVIDER });

    expect(result.dryRun).toBe(true);
    expect(embeddingService.createAndStoreEmbedding).not.toHaveBeenCalled();

    const after = db.prepare('SELECT id, importance, is_deleted FROM memory_item ORDER BY id').all();
    expect(after).toEqual(before);
    const afterEmbeddingCount = (db.prepare('SELECT COUNT(*) as c FROM memory_embedding').get() as { c: number }).c;
    expect(afterEmbeddingCount).toBe(beforeEmbeddingCount);
    expect(db.prepare('SELECT COUNT(*) as c FROM memory_forgetting_event').get()).toEqual({ c: 0 });
  });

  it('dry-run에서도 분류 결과는 정확해야 함', async () => {
    const service = new IntrospectionHealingService(db, fakeEmbeddingService() as any);
    const result = await service.heal({ provider: PROVIDER });

    expect(result.reEmbed.memoryIds).toEqual(['mem_reembed']);
    expect(result.softDelete.memoryIds).toEqual(['mem_softdelete']);
    expect(result.demote.memoryIds.sort()).toEqual(['mem_both', 'mem_demote']);
    expect(result.review.memoryIds.sort()).toEqual(['mem_floor', 'mem_pinned']);
    expect(result.scanned.union).toBe(6); // mem_ok 제외
  });

  it('apply 모드는 각 액션을 정확히 실행해야 함', async () => {
    const embeddingService = fakeEmbeddingService();
    const service = new IntrospectionHealingService(db, embeddingService as any);
    const result = await service.heal({ provider: PROVIDER, dryRun: false });

    expect(result.dryRun).toBe(false);

    // re-embed: 임베딩이 생성되어 저장됨
    expect(embeddingService.createAndStoreEmbedding).toHaveBeenCalledWith(
      db, 'mem_reembed', expect.any(String), 'episodic', PROVIDER,
    );
    expect(result.reEmbed.storedCount).toBe(1);
    expect(result.reEmbed.failedCount).toBe(0);

    // soft-delete: is_deleted=1 + 감사 로그
    const softDeleted = db.prepare('SELECT is_deleted FROM memory_item WHERE id = ?').get('mem_softdelete');
    expect(softDeleted).toEqual({ is_deleted: 1 });
    expect(result.softDelete.softDeletedCount).toBe(1);
    const event = db.prepare('SELECT action, reason, policy FROM memory_forgetting_event WHERE memory_id = ?').get('mem_softdelete');
    expect(event).toEqual({ action: 'soft', reason: 'introspection_heal', policy: 'introspection-heal' });

    // demote: importance = max(floor, importance * factor) = max(0.1, 0.5*0.8) = 0.4
    const demoted = db.prepare('SELECT importance FROM memory_item WHERE id = ?').get('mem_demote') as { importance: number };
    expect(demoted.importance).toBeCloseTo(0.4, 5);
    expect(result.demote.demotedCount).toBe(2); // mem_demote + mem_both

    // pinned은 손대지 않음
    const pinned = db.prepare('SELECT importance, is_deleted FROM memory_item WHERE id = ?').get('mem_pinned');
    expect(pinned).toEqual({ importance: 0.5, is_deleted: 0 });

    // 이미 floor인 메모리는 손대지 않음
    const floored = db.prepare('SELECT importance FROM memory_item WHERE id = ?').get('mem_floor');
    expect(floored).toEqual({ importance: 0.1 });
  });

  it('스캔에 아무것도 없으면 dry-run 여부와 무관하게 no-op이어야 함', async () => {
    const emptyDb = new Database(':memory:');
    createSchema(emptyDb);
    await new MetaMemoryStatsSchemaMigration().up(emptyDb);
    await new MemoryForgettingEventMigration().up(emptyDb);
    insertMemory(emptyDb, 'mem_ok', { importance: 0.9, avgConfidence: 0.95, failureCount: 0 });

    const service = new IntrospectionHealingService(emptyDb, fakeEmbeddingService() as any);
    const result = await service.heal({ provider: PROVIDER, dryRun: false });

    expect(result.scanned.union).toBe(0);
    expect(result.reEmbed.memoryIds).toEqual([]);
    expect(result.softDelete.memoryIds).toEqual([]);
    expect(result.demote.memoryIds).toEqual([]);
    expect(result.review.memoryIds).toEqual([]);
    emptyDb.close();
  });
});
