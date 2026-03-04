/**
 * DatabaseOptimizer 테스트
 * 데이터베이스 최적화 서비스 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseOptimizer } from '../database-optimizer.js';
import type { DatabaseStats, IndexRecommendation, QueryAnalysis } from '../database-optimizer.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../test/helpers/test-database.js';

describe('DatabaseOptimizer', () => {
  let db: Database.Database;
  let optimizer: DatabaseOptimizer;

  beforeEach(async () => {
    db = await setupTestDatabase();
    optimizer = new DatabaseOptimizer(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('analyzePerformance', () => {
    it('데이터베이스 성능을 분석해야 함', async () => {
      // Given: 테스트 데이터 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content, reflection_notes)
        VALUES ('test-1', 'episodic', 'Test content 1', NULL)
      `).run();

      // When: 성능 분석
      const stats = await optimizer.analyzePerformance();

      // Then: 분석 결과가 반환되어야 함
      expect(stats).toBeDefined();
      expect(stats.tableStats).toBeDefined();
      expect(stats.indexStats).toBeDefined();
      expect(stats.queryStats).toBeDefined();
    });

    it('테이블 통계를 포함해야 함', async () => {
      // Given: 테스트 데이터 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content, reflection_notes)
        VALUES ('test-1', 'episodic', 'Test content 1', NULL)
      `).run();

      // When: 성능 분석
      const stats = await optimizer.analyzePerformance();

      // Then: 테이블 통계가 포함되어야 함
      expect(stats.tableStats).toBeDefined();
      expect(stats.tableStats['memory_item']).toBeDefined();
      expect(stats.tableStats['memory_item'].rowCount).toBeGreaterThanOrEqual(0);
    });

    it('인덱스 통계를 포함해야 함', async () => {
      // When: 성능 분석
      const stats = await optimizer.analyzePerformance();

      // Then: 인덱스 통계가 포함되어야 함
      expect(stats.indexStats).toBeDefined();
      expect(typeof stats.indexStats).toBe('object');
    });

    it('쿼리 통계를 포함해야 함', async () => {
      // When: 성능 분석
      const stats = await optimizer.analyzePerformance();

      // Then: 쿼리 통계가 포함되어야 함
      expect(stats.queryStats).toBeDefined();
      expect(typeof stats.queryStats.totalQueries).toBe('number');
      expect(typeof stats.queryStats.averageTime).toBe('number');
      expect(Array.isArray(stats.queryStats.slowQueries)).toBe(true);
    });
  });

  describe('generateIndexRecommendations', () => {
    it('인덱스 권장 사항을 반환해야 함', async () => {
      // Given: 테스트 데이터 삽입 및 쿼리 기록
      db.prepare(`
        INSERT INTO memory_item (id, type, content, reflection_notes)
        VALUES ('test-1', 'episodic', 'Test content 1', NULL)
      `).run();
      optimizer.recordQuery('SELECT * FROM memory_item WHERE type = ?', 100);

      // When: 인덱스 권장 사항 조회
      const recommendations = await optimizer.generateIndexRecommendations();

      // Then: 권장 사항이 반환되어야 함
      expect(Array.isArray(recommendations)).toBe(true);
    });

    it('권장 사항이 올바른 구조를 가져야 함', async () => {
      // Given: 쿼리 기록
      optimizer.recordQuery('SELECT * FROM memory_item WHERE type = ?', 100);

      // When: 인덱스 권장 사항 조회
      const recommendations = await optimizer.generateIndexRecommendations();

      // Then: 권장 사항이 올바른 구조를 가져야 함
      if (recommendations.length > 0) {
        const rec = recommendations[0];
        expect(rec.table).toBeDefined();
        expect(Array.isArray(rec.columns)).toBe(true);
        expect(['btree', 'fts', 'partial']).toContain(rec.type);
        expect(['high', 'medium', 'low']).toContain(rec.priority);
        expect(rec.reason).toBeDefined();
      }
    });
  });

  describe('createIndex', () => {
    it('인덱스를 생성해야 함', async () => {
      // Given: 인덱스 이름, 테이블, 컬럼
      const indexName = 'idx_test_type';
      const table = 'memory_item';
      const columns = ['type'];

      // When: 인덱스 생성
      await optimizer.createIndex(indexName, table, columns);

      // Then: 인덱스가 생성되어야 함
      const index = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name = ?
      `).get(indexName);
      expect(index).toBeDefined();
    });

    it('이미 존재하는 인덱스는 건너뛰어야 함', async () => {
      // Given: 인덱스 생성
      const indexName = 'idx_test_type2';
      const table = 'memory_item';
      const columns = ['type'];
      await optimizer.createIndex(indexName, table, columns);

      // When: 동일한 인덱스 다시 생성 시도
      await optimizer.createIndex(indexName, table, columns);

      // Then: 에러가 발생하지 않아야 함 (IF NOT EXISTS)
      const index = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name = ?
      `).get(indexName);
      expect(index).toBeDefined();
    });
  });

  describe('dropIndex', () => {
    it('인덱스를 삭제해야 함', async () => {
      // Given: 인덱스 생성
      const indexName = 'idx_test_drop';
      await optimizer.createIndex(indexName, 'memory_item', ['type']);

      // When: 인덱스 삭제
      await optimizer.dropIndex(indexName);

      // Then: 인덱스가 삭제되어야 함
      const index = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name = ?
      `).get(indexName);
      expect(index).toBeUndefined();
    });
  });

  describe('analyzeDatabase', () => {
    it('ANALYZE를 실행해야 함', async () => {
      // When: ANALYZE 실행
      await optimizer.analyzeDatabase();

      // Then: 에러가 발생하지 않아야 함
      expect(true).toBe(true);
    });
  });

  describe('recordQuery', () => {
    it('쿼리를 기록해야 함', () => {
      // Given: 쿼리
      const query = 'SELECT * FROM memory_item';
      const executionTime = 50;

      // When: 쿼리 기록
      optimizer.recordQuery(query, executionTime);

      // Then: 쿼리가 기록되어야 함
      const history = (optimizer as any).queryHistory;
      expect(history.has(query)).toBe(true);
      const record = history.get(query);
      expect(record.count).toBe(1);
      expect(record.totalTime).toBe(executionTime);
    });

    it('동일한 쿼리를 여러 번 기록하면 카운트가 증가해야 함', () => {
      // Given: 쿼리
      const query = 'SELECT * FROM memory_item';
      optimizer.recordQuery(query, 50);
      optimizer.recordQuery(query, 60);

      // When: 쿼리 기록 확인
      const history = (optimizer as any).queryHistory;
      const record = history.get(query);

      // Then: 카운트가 증가해야 함
      expect(record.count).toBe(2);
      expect(record.totalTime).toBe(110);
    });
  });

  describe('generateOptimizationReport', () => {
    it('최적화 리포트를 생성해야 함', async () => {
      // Given: 테스트 데이터 삽입
      db.prepare(`
        INSERT INTO memory_item (id, type, content, reflection_notes)
        VALUES ('test-1', 'episodic', 'Test content 1', NULL)
      `).run();

      // When: 최적화 리포트 생성
      const report = await optimizer.generateOptimizationReport();

      // Then: 리포트가 생성되어야 함
      expect(report).toBeDefined();
      expect(typeof report).toBe('string');
      expect(report).toContain('데이터베이스 성능 최적화 리포트');
    });
  });
});

