/**
 * VectorSearchFactory 테스트
 * 벡터 검색 팩토리 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorSearchFactory } from '../vector-search.factory.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';

describe('VectorSearchFactory', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase(db);
  });

  describe('createFacade', () => {
    it('벡터 검색 파사드를 생성해야 함', () => {
      // When: 파사드 생성
      const facade = VectorSearchFactory.createFacade(db);

      // Then: 파사드가 생성되어야 함
      expect(facade).toBeDefined();
      expect(typeof facade.search).toBe('function');
      expect(typeof facade.hybridSearch).toBe('function');
      expect(typeof facade.getIndexStatus).toBe('function');
      expect(typeof facade.rebuildIndex).toBe('function');
    });

    it('파사드가 모든 메서드를 제공해야 함', () => {
      // Given: 파사드 생성
      const facade = VectorSearchFactory.createFacade(db);

      // Then: 모든 메서드가 제공되어야 함
      expect(typeof facade.search).toBe('function');
      expect(typeof facade.hybridSearch).toBe('function');
      expect(typeof facade.providerHybridSearch).toBe('function');
      expect(typeof facade.unifiedSearch).toBe('function');
      expect(typeof facade.getIndexStatus).toBe('function');
      expect(typeof facade.rebuildIndex).toBe('function');
      expect(typeof facade.isAvailable).toBe('function');
      expect(typeof facade.runPerformanceTest).toBe('function');
      expect(typeof facade.analyzePerformance).toBe('function');
      expect(typeof facade.generatePerformanceReport).toBe('function');
      expect(typeof facade.getStatusSummary).toBe('function');
      expect(typeof facade.getSystemStatus).toBe('function');
    });
  });

  describe('createSearchService', () => {
    it('벡터 검색 서비스를 생성해야 함', async () => {
      // When: 검색 서비스 생성
      const service = await VectorSearchFactory.createSearchService(db);

      // Then: 서비스가 생성되어야 함
      expect(service).toBeDefined();
      expect(typeof service.search).toBe('function');
    });

    it('서비스가 비동기로 생성되어야 함', async () => {
      // When: 검색 서비스 생성
      const servicePromise = VectorSearchFactory.createSearchService(db);

      // Then: Promise 반환
      expect(servicePromise).toBeInstanceOf(Promise);
      const service = await servicePromise;
      expect(service).toBeDefined();
    });
  });

  describe('createIndexManager', () => {
    it('인덱스 매니저를 생성해야 함', async () => {
      // When: 인덱스 매니저 생성
      const manager = await VectorSearchFactory.createIndexManager(db);

      // Then: 매니저가 생성되어야 함
      expect(manager).toBeDefined();
      expect(typeof manager.getIndexStatus).toBe('function');
      expect(typeof manager.rebuildIndex).toBe('function');
      expect(typeof manager.isAvailable).toBe('function');
      expect(typeof manager.getStatusSummary).toBe('function');
    });

    it('매니저가 비동기로 생성되어야 함', async () => {
      // When: 인덱스 매니저 생성
      const managerPromise = VectorSearchFactory.createIndexManager(db);

      // Then: Promise 반환
      expect(managerPromise).toBeInstanceOf(Promise);
      const manager = await managerPromise;
      expect(manager).toBeDefined();
    });
  });

  describe('createPerformanceTester', () => {
    it('성능 테스터를 생성해야 함', async () => {
      // When: 성능 테스터 생성
      const tester = await VectorSearchFactory.createPerformanceTester(db);

      // Then: 테스터가 생성되어야 함
      expect(tester).toBeDefined();
      expect(typeof tester.runPerformanceTest).toBe('function');
      expect(typeof tester.analyzeResults).toBe('function');
      expect(typeof tester.generateReport).toBe('function');
    });

    it('테스터가 비동기로 생성되어야 함', async () => {
      // When: 성능 테스터 생성
      const testerPromise = VectorSearchFactory.createPerformanceTester(db);

      // Then: Promise 반환
      expect(testerPromise).toBeInstanceOf(Promise);
      const tester = await testerPromise;
      expect(tester).toBeDefined();
    });
  });

  describe('팩토리 메서드 일관성', () => {
    it('동일한 데이터베이스로 여러 객체를 생성할 수 있어야 함', async () => {
      // When: 여러 객체 생성
      const facade = VectorSearchFactory.createFacade(db);
      const service = await VectorSearchFactory.createSearchService(db);
      const manager = await VectorSearchFactory.createIndexManager(db);
      const tester = await VectorSearchFactory.createPerformanceTester(db);

      // Then: 모든 객체가 생성되어야 함
      expect(facade).toBeDefined();
      expect(service).toBeDefined();
      expect(manager).toBeDefined();
      expect(tester).toBeDefined();
    });
  });
});

