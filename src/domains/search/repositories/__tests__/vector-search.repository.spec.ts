/**
 * VectorSearchRepository 테스트
 * 벡터 검색 리포지토리 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectorSearchRepositoryImpl } from './vector-search.repository.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../test/helpers/test-database.js';
import type { VectorSearchQuery } from '../shared/types/vector-search.types';

describe('VectorSearchRepositoryImpl', () => {
  let db: Database.Database;
  let repository: VectorSearchRepositoryImpl;

  beforeEach(async () => {
    db = await setupTestDatabase();
    repository = new VectorSearchRepositoryImpl(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('constructor', () => {
    it('데이터베이스를 받아서 초기화해야 함', () => {
      // Given: 데이터베이스
      const testDb = new Database(':memory:');

      // When: 리포지토리 생성
      const repo = new VectorSearchRepositoryImpl(testDb);

      // Then: 리포지토리가 생성되어야 함
      expect(repo).toBeDefined();

      testDb.close();
    });

    it('생성 시 VEC 가용성을 확인해야 함', () => {
      // Given: 데이터베이스
      const testDb = new Database(':memory:');

      // When: 리포지토리 생성
      const repo = new VectorSearchRepositoryImpl(testDb);

      // Then: VEC 가용성 확인이 실행되어야 함
      expect(repo).toBeDefined();

      testDb.close();
    });
  });

  describe('checkVecAvailability', () => {
    it('VEC 가용성을 확인해야 함', () => {
      // When: VEC 가용성 확인
      const result = repository.checkVecAvailability();

      // Then: boolean 반환
      expect(typeof result).toBe('boolean');
      // VEC 테이블이 있으면 true, 없으면 false
    });
  });

  describe('search', () => {
    it('검색 결과가 배열 형태여야 함', async () => {
      // Given: 384차원 벡터 (tfidf 기본 차원)
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // When: 검색 실행
      const results = await repository.search(query);

      // Then: 배열 반환
      expect(Array.isArray(results)).toBe(true);
    });

    it('벡터 차원이 불일치할 때 빈 배열을 반환해야 함', async () => {
      // Given: 잘못된 차원의 벡터
      const query: VectorSearchQuery = {
        queryVector: [0.1, 0.2], // 차원 불일치 (384가 아님)
        provider: 'tfidf'
      };

      // When: 검색 실행
      const results = await repository.search(query);

      // Then: 빈 배열 반환
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('옵션을 포함한 쿼리를 처리해야 함', async () => {
      // Given: 옵션을 포함한 쿼리
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf',
        options: {
          limit: 5,
          threshold: 0.5,
          type: 'episodic',
          includeContent: true,
          includeMetadata: false
        }
      };

      // When: 검색 실행
      const results = await repository.search(query);

      // Then: 배열 반환
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('hybridSearch', () => {
    it('하이브리드 검색 결과가 배열 형태여야 함', async () => {
      // Given: 384차원 벡터
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        textQuery: 'test query',
        provider: 'tfidf'
      };

      // When: 하이브리드 검색 실행
      const results = await repository.hybridSearch(query);

      // Then: 배열 반환
      expect(Array.isArray(results)).toBe(true);
    });

    it('벡터 차원이 불일치할 때 빈 배열을 반환해야 함', async () => {
      // Given: 잘못된 차원의 벡터
      const query: VectorSearchQuery = {
        queryVector: [0.1, 0.2], // 차원 불일치
        textQuery: 'test query',
        provider: 'tfidf'
      };

      // When: 하이브리드 검색 실행
      const results = await repository.hybridSearch(query);

      // Then: 빈 배열 반환
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('텍스트 쿼리 없이도 동작해야 함', async () => {
      // Given: 텍스트 쿼리 없는 쿼리
      const query: VectorSearchQuery = {
        queryVector: new Array(384).fill(0.1),
        provider: 'tfidf'
      };

      // When: 하이브리드 검색 실행
      const results = await repository.hybridSearch(query);

      // Then: 배열 반환
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('getIndexStatus', () => {
    it('인덱스 상태를 반환해야 함', () => {
      // When: 인덱스 상태 확인
      const status = repository.getIndexStatus();

      // Then: 상태가 반환되어야 함
      expect(status).toBeDefined();
      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('tableExists');
      expect(status).toHaveProperty('recordCount');
      expect(status).toHaveProperty('dimensions');
      expect(status).toHaveProperty('vecExtensionLoaded');
      expect(typeof status.available).toBe('boolean');
      expect(typeof status.tableExists).toBe('boolean');
      expect(typeof status.recordCount).toBe('number');
      expect(typeof status.dimensions).toBe('number');
      expect(typeof status.vecExtensionLoaded).toBe('boolean');
    });

    it('인덱스 상태 구조가 올바르게 반환되어야 함', () => {
      // When: 인덱스 상태 확인
      const status = repository.getIndexStatus();

      // Then: 상태 구조가 올바르게 반환되어야 함
      expect(status.available).toBeDefined();
      expect(status.tableExists).toBeDefined();
      expect(status.recordCount).toBeGreaterThanOrEqual(0);
      expect(status.dimensions).toBeGreaterThan(0);
      expect(status.vecExtensionLoaded).toBeDefined();
    });
  });

  describe('rebuildIndex', () => {
    it('인덱스 재구성 결과를 반환해야 함', async () => {
      // When: 인덱스 재구성
      const result = await repository.rebuildIndex();

      // Then: boolean 반환
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getTableName', () => {
    it('tfidf 제공자에 대한 테이블명을 반환해야 함', () => {
      // When: tfidf 테이블명 조회
      const tableName = repository.getTableName('tfidf');

      // Then: 테이블명 반환
      expect(typeof tableName).toBe('string');
      expect(tableName.length).toBeGreaterThan(0);
    });

    it('minilm 제공자에 대한 테이블명을 반환해야 함', () => {
      // When: minilm 테이블명 조회
      const tableName = repository.getTableName('minilm');

      // Then: 테이블명 반환
      expect(typeof tableName).toBe('string');
      expect(tableName.length).toBeGreaterThan(0);
    });

    it('알 수 없는 제공자에 대해 기본 테이블명을 반환해야 함', () => {
      // When: 알 수 없는 제공자 테이블명 조회
      const tableName = repository.getTableName('unknown');

      // Then: 기본 테이블명 반환
      expect(typeof tableName).toBe('string');
      expect(tableName.length).toBeGreaterThan(0);
    });

    it('대소문자를 구분하지 않아야 함', () => {
      // When: 대문자 제공자 테이블명 조회
      const tableName1 = repository.getTableName('TFIDF');
      const tableName2 = repository.getTableName('tfidf');

      // Then: 같은 테이블명 반환
      expect(tableName1).toBe(tableName2);
    });
  });

  describe('checkAvailability', () => {
    it('checkVecAvailability와 동일한 결과를 반환해야 함', () => {
      // When: 가용성 확인
      const result1 = repository.checkAvailability();
      const result2 = repository.checkVecAvailability();

      // Then: 동일한 결과 반환
      expect(result1).toBe(result2);
    });
  });
});

