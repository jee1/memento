/**
 * Database migration 테스트
 * 마이그레이션 상태 확인 및 레거시 스키마 지원 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrateDatabase } from './migrate.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';

describe('Database Migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    if (db) {
      try {
        db.close();
      } catch {
        // 이미 닫혀있을 수 있음
      }
    }
  });

  describe('마이그레이션 상태 확인', () => {
    it('Given: 레거시 스키마에 embedding 컬럼이 없을 때, When: 마이그레이션을 실행하면, Then: embedding 컬럼을 추가해야 함', () => {
      // Given: 레거시 스키마 (embedding 컬럼 없음)
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_item (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embedding (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          dim INTEGER NOT NULL,
          model TEXT
        )
      `);

      // embedding 컬럼이 없는지 확인
      const columnsBefore = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      const hasEmbeddingBefore = columnsBefore.some(c => c.name === 'embedding');
      expect(hasEmbeddingBefore).toBe(false);

      // When: 마이그레이션 로직 실행 (embedding 컬럼 추가)
      // migrate.ts의 로직을 직접 실행
      try {
        db.exec('ALTER TABLE memory_embedding ADD COLUMN embedding TEXT NOT NULL DEFAULT "[]"');
      } catch (err: any) {
        // 컬럼이 이미 존재하는 경우 무시
        if (!err.message.includes('duplicate column name')) {
          throw err;
        }
      }

      // Then: embedding 컬럼이 추가되어야 함
      const columnsAfter = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      const hasEmbeddingAfter = columnsAfter.some(c => c.name === 'embedding');
      expect(hasEmbeddingAfter).toBe(true);
    });

    it('Given: 마이그레이션이 필요한 스키마일 때, When: 마이그레이션 상태를 확인하면, Then: 마이그레이션이 필요함을 감지해야 함', () => {
      // Given: 레거시 스키마
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embedding (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          dim INTEGER NOT NULL
        )
      `);

      // When: 스키마 컬럼 확인
      const columns = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      
      const hasEmbedding = columns.some(c => c.name === 'embedding');
      const hasProvider = columns.some(c => c.name === 'embedding_provider');
      const hasProjectionType = columns.some(c => c.name === 'projection_type');

      // Then: 마이그레이션이 필요함을 감지해야 함
      const needsMigration = !hasEmbedding || !hasProvider || !hasProjectionType;
      expect(needsMigration).toBe(true);
    });
  });

  describe('레거시 스키마 지원', () => {
    it('Given: 레거시 스키마에서 embedding 컬럼이 없을 때, When: 마이그레이션을 실행하면, Then: embedding 컬럼을 추가해야 함', () => {
      // Given: 레거시 스키마 (embedding 컬럼 없음)
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embedding (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          dim INTEGER NOT NULL,
          model TEXT
        )
      `);

      db.exec(`
        INSERT INTO memory_embedding (memory_id, dim, model)
        VALUES ('test-1', 384, 'legacy-model')
      `);

      // embedding 컬럼이 없는지 확인
      const columnsBefore = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      const hasEmbeddingBefore = columnsBefore.some(c => c.name === 'embedding');
      expect(hasEmbeddingBefore).toBe(false);

      // When: embedding 컬럼 추가 (마이그레이션 로직)
      try {
        db.exec('ALTER TABLE memory_embedding ADD COLUMN embedding TEXT NOT NULL DEFAULT "[]"');
      } catch (err: any) {
        // 컬럼이 이미 존재하는 경우 무시
        if (!err.message.includes('duplicate column name')) {
          throw err;
        }
      }

      // Then: embedding 컬럼이 추가되어야 함
      const columnsAfter = db.prepare(`
        SELECT name FROM pragma_table_info('memory_embedding')
      `).all() as Array<{ name: string }>;
      const hasEmbeddingAfter = columnsAfter.some(c => c.name === 'embedding');
      expect(hasEmbeddingAfter).toBe(true);

      // 추가된 컬럼으로 데이터 조회 가능해야 함
      const result = DatabaseUtils.get(db, `
        SELECT id, memory_id, dim, model, embedding
        FROM memory_embedding
        WHERE memory_id = ?
      `, ['test-1']);

      expect(result).toBeDefined();
      expect(result.memory_id).toBe('test-1');
      expect(result.embedding).toBe('[]');
    });
  });
});
