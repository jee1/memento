/**
 * Meta Memory Introspection Service 테스트 (Issue #21)
 *
 * Given/When/Then: M2 자기성찰 스캔 동작 검증
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MetaMemoryIntrospectionService } from '../meta-memory-introspection-service.js';
import { MetaMemoryStatsSchemaMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/011-meta-memory-stats-schema.js';

/** memory_item 최소 스키마 (테스트용) */
function createBaseSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      migration_name TEXT NOT NULL,
      checksum TEXT,
      applied_by TEXT DEFAULT 'system',
      description TEXT
    );
  `);
}

describe('MetaMemoryIntrospectionService', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    createBaseSchema(db);
    const migration = new MetaMemoryStatsSchemaMigration();
    await migration.up(db);

    // Given: memory_item 레코드 (외래키용)
    db.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned) VALUES ('mem_low_conf', 'episodic', 'Low confidence memory', 0.5, 'private', CURRENT_TIMESTAMP, 0),
        ('mem_high_fail', 'episodic', 'High failure memory', 0.6, 'private', CURRENT_TIMESTAMP, 0),
        ('mem_ok', 'semantic', 'OK memory', 0.7, 'private', CURRENT_TIMESTAMP, 0)
    `);

    // Given: meta_memory_stats - 저신뢰(avg_confidence < 0.5), 고실패(failure_count >= 2)
    db.exec(`
      INSERT INTO meta_memory_stats (
        memory_id, recall_count, success_count, failure_count,
        avg_confidence, last_recalled_at, created_at, updated_at
      ) VALUES
        ('mem_low_conf', 10, 3, 7, 0.35, datetime('now'), datetime('now'), datetime('now')),
        ('mem_high_fail', 5, 1, 4, 0.6, datetime('now'), datetime('now'), datetime('now')),
        ('mem_ok', 8, 7, 1, 0.85, datetime('now'), datetime('now'), datetime('now'))
    `);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('given: DB에 저신뢰·고실패 메모리 통계가 있을 때, when: runScan을 호출하면, then: lowConfidenceMemoryIds·highFailureMemoryIds·summary를 반환해야 함', async () => {
    // When: M2 스캔 실행
    const result = await MetaMemoryIntrospectionService.runScan(db, {
      agentId: 'default',
      lowConfidenceThreshold: 0.5,
      highFailureCountThreshold: 2
    });

    // Then: 저신뢰 메모리 ID 목록에 mem_low_conf 포함
    expect(result.lowConfidenceMemoryIds).toContain('mem_low_conf');
    expect(result.lowConfidenceMemoryIds).not.toContain('mem_ok');

    // Then: 고실패 메모리 ID 목록에 mem_high_fail 포함 (failure_count >= 2)
    expect(result.highFailureMemoryIds).toContain('mem_high_fail');
    expect(result.highFailureMemoryIds).not.toContain('mem_ok');

    // Then: 요약 문자열 존재
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('given: meta_memory_stats가 비어 있을 때, when: runScan을 호출하면, then: 빈 배열과 빈 요약을 반환해야 함', async () => {
    const emptyDb = new Database(':memory:');
    createBaseSchema(emptyDb);
    const migration = new MetaMemoryStatsSchemaMigration();
    await migration.up(emptyDb);
    emptyDb.exec(`
      INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned) VALUES ('mem_only', 'episodic', 'Only item', 0.5, 'private', CURRENT_TIMESTAMP, 0)
    `);

    const result = await MetaMemoryIntrospectionService.runScan(emptyDb, { agentId: 'default' });

    expect(result.lowConfidenceMemoryIds).toEqual([]);
    expect(result.highFailureMemoryIds).toEqual([]);
    expect(result.summary).toBeDefined();
    emptyDb.close();
  });

  it('given: 비정상 옵션(NaN, 범위 밖)이 있을 때, when: runScan을 호출하면, then: 기본값으로 안전하게 동작해야 함', async () => {
    const result = await MetaMemoryIntrospectionService.runScan(db, {
      lowConfidenceThreshold: Number.NaN,
      highFailureCountThreshold: -1,
      limit: -5
    });

    // 기본값 적용: lowConfidence 0.5, highFailure 2, limit 1000 → mem_low_conf·mem_high_fail 여전히 포함
    expect(result.lowConfidenceMemoryIds).toContain('mem_low_conf');
    expect(result.highFailureMemoryIds).toContain('mem_high_fail');
    expect(result.summary).toBeDefined();
  });

  /** T1: ID 목록 limit 절삭 시 총계·truncated·summary 반영 */
  it('reports lowConfidenceTotal and truncated when ID list is capped by limit', async () => {
    const truncDb = new Database(':memory:');
    createBaseSchema(truncDb);
    const migration = new MetaMemoryStatsSchemaMigration();
    await migration.up(truncDb);

    for (let i = 0; i < 5; i++) {
      const id = `mem_low_trunc_${i}`;
      truncDb.exec(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES ('${id}', 'episodic', 'Low conf ${i}', 0.5, 'private', CURRENT_TIMESTAMP, 0)
      `);
      truncDb.exec(`
        INSERT INTO meta_memory_stats (
          memory_id, recall_count, success_count, failure_count,
          avg_confidence, last_recalled_at, created_at, updated_at
        ) VALUES (
          '${id}', 1, 0, 0, 0.1, datetime('now'), datetime('now'), datetime('now')
        )
      `);
    }

    const result = await MetaMemoryIntrospectionService.runScan(truncDb, { limit: 2 });

    expect(result.lowConfidenceMemoryIds.length).toBe(2);
    expect(result.lowConfidenceTotal).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.summary).toContain('저신뢰 메모리 5건');
    expect(result.summary).not.toContain('저신뢰 메모리 2건');
    expect(result.summary).toContain('(ID 목록은 상위 2건만 포함)');
    truncDb.close();
  });

  /** T2: limit 이 충분하면 truncated false, summary 에 절삭 꼬리 없음 */
  it('does not mark truncated when limit covers all matching rows', async () => {
    const truncDb = new Database(':memory:');
    createBaseSchema(truncDb);
    const migration = new MetaMemoryStatsSchemaMigration();
    await migration.up(truncDb);

    for (let i = 0; i < 5; i++) {
      const id = `mem_low_full_${i}`;
      truncDb.exec(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES ('${id}', 'episodic', 'Low conf ${i}', 0.5, 'private', CURRENT_TIMESTAMP, 0)
      `);
      truncDb.exec(`
        INSERT INTO meta_memory_stats (
          memory_id, recall_count, success_count, failure_count,
          avg_confidence, last_recalled_at, created_at, updated_at
        ) VALUES (
          '${id}', 1, 0, 0, 0.1, datetime('now'), datetime('now'), datetime('now')
        )
      `);
    }

    const result = await MetaMemoryIntrospectionService.runScan(truncDb, { limit: 10 });

    expect(result.truncated).toBe(false);
    expect(result.lowConfidenceTotal).toBe(5);
    expect(result.lowConfidenceMemoryIds.length).toBe(5);
    expect(result.summary).not.toContain('(ID 목록은');
    truncDb.close();
  });

  /** T3: 고실패 축만 절삭돼도 truncated true */
  it('sets truncated when only highFailureMemoryIds are capped', async () => {
    const truncDb = new Database(':memory:');
    createBaseSchema(truncDb);
    const migration = new MetaMemoryStatsSchemaMigration();
    await migration.up(truncDb);

    for (let i = 0; i < 4; i++) {
      const id = `mem_high_fail_trunc_${i}`;
      truncDb.exec(`
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at, pinned)
        VALUES ('${id}', 'episodic', 'High fail ${i}', 0.5, 'private', CURRENT_TIMESTAMP, 0)
      `);
      truncDb.exec(`
        INSERT INTO meta_memory_stats (
          memory_id, recall_count, success_count, failure_count,
          avg_confidence, last_recalled_at, created_at, updated_at
        ) VALUES (
          '${id}', 10, 1, 3, 0.9, datetime('now'), datetime('now'), datetime('now')
        )
      `);
    }

    const result = await MetaMemoryIntrospectionService.runScan(truncDb, { limit: 1 });

    expect(result.lowConfidenceMemoryIds).toEqual([]);
    expect(result.lowConfidenceTotal).toBe(0);
    expect(result.highFailureTotal).toBe(4);
    expect(result.highFailureMemoryIds.length).toBe(1);
    expect(result.truncated).toBe(true);
    truncDb.close();
  });
});
