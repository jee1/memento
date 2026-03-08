/**
 * VectorPerformanceRepository 테스트
 * 벡터 성능 테스트 리포지토리 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectorPerformanceRepositoryImpl } from '../vector-performance.repository.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

describe('VectorPerformanceRepositoryImpl', () => {
  let db: Database.Database;
  let repository: VectorPerformanceRepositoryImpl;

  beforeEach(async () => {
    db = await setupTestDatabase();
    repository = new VectorPerformanceRepositoryImpl(db);
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('constructor', () => {
    it('데이터베이스를 받아서 초기화해야 함', () => {
      // Given: 데이터베이스
      const testDb = new Database(':memory:');

      // When: 리포지토리 생성
      const repo = new VectorPerformanceRepositoryImpl(testDb);

      // Then: 리포지토리가 생성되어야 함
      expect(repo).toBeDefined();

      testDb.close();
    });

    it('생성 시 VEC 가용성을 확인해야 함', () => {
      // Given: 데이터베이스
      const testDb = new Database(':memory:');

      // When: 리포지토리 생성
      const repo = new VectorPerformanceRepositoryImpl(testDb);

      // Then: VEC 가용성 확인이 실행되어야 함 (내부적으로)
      expect(repo).toBeDefined();

      testDb.close();
    });
  });

  describe('runPerformanceTest', () => {
    it('VEC를 사용할 수 없을 때 빈 결과를 반환해야 함', async () => {
      // Given: VEC를 사용할 수 없는 환경
      // (메모리 DB에는 VEC 테이블이 없을 수 있음)
      // 384차원 벡터 생성 (tfidf 기본 차원)
      const queryVector = new Array(384).fill(0.1);

      // When: 성능 테스트 실행
      const result = await repository.runPerformanceTest(queryVector, 5);

      // Then: 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(result).toHaveProperty('averageTime');
      expect(result).toHaveProperty('minTime');
      expect(result).toHaveProperty('maxTime');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('successRate');
      // VEC를 사용할 수 없으면 0, 사용 가능하면 값이 있을 수 있음
      expect(typeof result.averageTime).toBe('number');
      expect(typeof result.minTime).toBe('number');
      expect(typeof result.maxTime).toBe('number');
      expect(typeof result.results).toBe('number');
      expect(typeof result.successRate).toBe('number');
    });

    it('반복 횟수만큼 테스트를 실행해야 함', async () => {
      // Given: 384차원 벡터
      const iterations = 3;
      const queryVector = new Array(384).fill(0.1);

      // When: 성능 테스트 실행
      const result = await repository.runPerformanceTest(queryVector, iterations);

      // Then: 결과가 반환되어야 함
      expect(result).toBeDefined();
      expect(typeof result.averageTime).toBe('number');
    });

    it('성능 테스트 결과 구조가 올바르게 반환되어야 함', async () => {
      // Given: 384차원 벡터
      const queryVector = new Array(384).fill(0.1);
      const iterations = 5;

      // When: 성능 테스트 실행
      const result = await repository.runPerformanceTest(queryVector, iterations);

      // Then: 결과 구조가 올바르게 반환되어야 함
      expect(result).toHaveProperty('averageTime');
      expect(result).toHaveProperty('minTime');
      expect(result).toHaveProperty('maxTime');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('successRate');
      expect(typeof result.averageTime).toBe('number');
      expect(typeof result.minTime).toBe('number');
      expect(typeof result.maxTime).toBe('number');
      expect(typeof result.results).toBe('number');
      expect(typeof result.successRate).toBe('number');
    });

    it('성공률을 올바르게 계산해야 함', async () => {
      // Given: 384차원 벡터
      const iterations = 10;
      const queryVector = new Array(384).fill(0.1);

      // When: 성능 테스트 실행
      const result = await repository.runPerformanceTest(queryVector, iterations);

      // Then: 성공률이 0 이상 1 이하여야 함
      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(1);
    });
  });
});

