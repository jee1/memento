/**
 * Introspection Heal Tool 테스트 (Issue #728)
 *
 * 도구 배선(zod 검증 → IntrospectionHealingService 위임 → 결과 직렬화)만 검증한다.
 * 분류/치유 로직 자체는 introspection-healing-service.spec.ts에서 검증한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { IntrospectionHealTool } from '../introspection-heal-tool.js';
import type { ToolContext } from '../../../../tools/types.js';
import { MetaMemoryStatsSchemaMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/011-meta-memory-stats-schema.js';
import { MemoryForgettingEventMigration } from '../../../../infrastructure/database/sqlite/migration/migrations/037-memory-forgetting-event.js';

describe('IntrospectionHealTool', () => {
  let db: Database.Database;
  let context: ToolContext;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, content TEXT NOT NULL,
        importance REAL DEFAULT 0.5, pinned BOOLEAN DEFAULT FALSE,
        is_deleted BOOLEAN DEFAULT FALSE NOT NULL, deleted_at TEXT
      );
      CREATE TABLE memento_schema_version (
        version TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        migration_name TEXT NOT NULL, checksum TEXT, applied_by TEXT DEFAULT 'system', description TEXT
      );
      CREATE TABLE memory_embedding (
        memory_id TEXT NOT NULL, embedding_provider TEXT NOT NULL, projection_type TEXT NOT NULL,
        embedding TEXT NOT NULL, dim INTEGER NOT NULL, dimensions INTEGER, model TEXT, created_by TEXT, created_at TEXT,
        UNIQUE(memory_id, embedding_provider, projection_type)
      );
    `);
    await new MetaMemoryStatsSchemaMigration().up(db);
    await new MemoryForgettingEventMigration().up(db);

    db.prepare(`INSERT INTO memory_item (id, type, content, importance) VALUES ('mem_low', 'episodic', 'low conf', 0.5)`).run();
    db.prepare(`
      INSERT INTO meta_memory_stats (memory_id, recall_count, success_count, failure_count, avg_confidence, created_at, updated_at)
      VALUES ('mem_low', 10, 3, 0, 0.3, datetime('now'), datetime('now'))
    `).run();

    context = {
      db,
      services: {
        embeddingService: {
          isAvailable: () => true,
          createAndStoreEmbedding: vi.fn().mockImplementation(async (dbArg: Database.Database, memoryId: string) => {
            dbArg.prepare(`
              INSERT INTO memory_embedding (memory_id, embedding_provider, projection_type, embedding, dim, dimensions)
              VALUES (?, 'minilm', 'native', '[]', 384, 384)
            `).run(memoryId);
            return { provider: 'minilm', embedding: Array(384).fill(0) };
          }),
        } as any,
      },
    };
  });

  afterEach(() => db.close());

  it('dry_run 기본값(true)이면 DB를 바꾸지 않고 분류만 반환해야 함', async () => {
    const tool = new IntrospectionHealTool();
    const result = await tool.handle({}, context);
    const data = JSON.parse(result.content[0].text);

    expect(data.dryRun).toBe(true);
    expect(data.reEmbed.memoryIds).toEqual(['mem_low']);
    expect(db.prepare('SELECT COUNT(*) as c FROM memory_embedding').get()).toEqual({ c: 0 });
  });

  it('dry_run: false면 실제로 재임베딩을 실행해야 함', async () => {
    const tool = new IntrospectionHealTool();
    const result = await tool.handle({ dry_run: false }, context);
    const data = JSON.parse(result.content[0].text);

    expect(data.dryRun).toBe(false);
    expect(data.reEmbed.storedCount).toBe(1);
    expect(db.prepare('SELECT COUNT(*) as c FROM memory_embedding').get()).toEqual({ c: 1 });
  });

  it('잘못된 파라미터는 검증 에러를 반환해야 함', async () => {
    const tool = new IntrospectionHealTool();
    const result = await tool.handle({ demote_factor: 2 }, context);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toBe('INVALID_PARAMETERS');
  });
});
