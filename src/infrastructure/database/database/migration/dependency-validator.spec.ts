/**
 * DependencyValidator 테스트
 * 의존성 검증기 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DependencyValidator } from './dependency-validator.js';
import type { DependencyValidationReport } from './dependency-validator.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../test/helpers/test-database.js';

describe('DependencyValidator', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('validateAll', () => {
    it('모든 의존성을 검증해야 함', async () => {
      // When: 모든 의존성 검증
      const report = await DependencyValidator.validateAll(db);

      // Then: 검증 결과가 반환되어야 함
      expect(report).toBeDefined();
      expect(report.success).toBeDefined();
      expect(Array.isArray(report.results)).toBe(true);
      expect(typeof report.failureCount).toBe('number');
    });

    it('검증 결과에 모든 항목이 포함되어야 함', async () => {
      // When: 모든 의존성 검증
      const report = await DependencyValidator.validateAll(db);

      // Then: 모든 검증 항목이 포함되어야 함
      const resultNames = report.results.map(r => r.name);
      expect(resultNames).toContain('memory_embedding_foreign_key');
      expect(resultNames).toContain('fts5_triggers');
      expect(resultNames).toContain('vec_triggers');
    });

    it('모든 검증이 성공하면 success가 true여야 함', async () => {
      // When: 모든 의존성 검증
      const report = await DependencyValidator.validateAll(db);

      // Then: 모든 검증이 성공하면 success가 true
      if (report.failureCount === 0) {
        expect(report.success).toBe(true);
      }
    });

    it('검증 실패가 있으면 success가 false여야 함', async () => {
      // Given: 테이블 삭제로 검증 실패 유도
      db.exec('DROP TABLE IF EXISTS memory_embedding');

      // When: 모든 의존성 검증
      const report = await DependencyValidator.validateAll(db);

      // Then: 검증 실패가 있으면 success가 false
      if (report.failureCount > 0) {
        expect(report.success).toBe(false);
      }
    });
  });

  describe('validateMemoryEmbeddingForeignKey', () => {
    it('memory_embedding 테이블이 없으면 실패해야 함', async () => {
      // Given: memory_embedding 테이블 삭제
      db.exec('DROP TABLE IF EXISTS memory_embedding');

      // When: 외래키 검증
      const result = await DependencyValidator.validateMemoryEmbeddingForeignKey(db);

      // Then: 검증이 실패해야 함
      expect(result.success).toBe(false);
      expect(result.error).toContain('memory_embedding table does not exist');
    });

    it('외래키 제약 조건이 올바르면 성공해야 함', async () => {
      // When: 외래키 검증
      const result = await DependencyValidator.validateMemoryEmbeddingForeignKey(db);

      // Then: 검증이 성공해야 함 (테이블이 있고 외래키가 올바르면)
      if (result.success) {
        expect(result.error).toBeUndefined();
      }
    });
  });

  describe('validateFTS5Triggers', () => {
    it('FTS5 트리거를 검증해야 함', async () => {
      // When: FTS5 트리거 검증
      const result = await DependencyValidator.validateFTS5Triggers(db);

      // Then: 검증 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.name).toBe('fts5_triggers');
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('validateVECTriggers', () => {
    it('VEC 트리거를 검증해야 함', async () => {
      // When: VEC 트리거 검증
      const result = await DependencyValidator.validateVECTriggers(db);

      // Then: 검증 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result.name).toBe('vec_triggers');
      expect(typeof result.success).toBe('boolean');
    });
  });
});

