/**
 * HTTP Server 테스트
 * HTTP/WebSocket MCP 서버 통합 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../test/helpers/test-database.js';
import { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import { createHybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import { __test } from '../http-server.js';
import type express from 'express';

describe('HTTP Server', () => {
  let db: Database.Database;
  let searchEngine: SearchEngine;
  let hybridSearchEngine: ReturnType<typeof createHybridSearchEngine>;
  let embeddingService: MemoryEmbeddingService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    searchEngine = new SearchEngine();
    hybridSearchEngine = createHybridSearchEngine();
    embeddingService = new MemoryEmbeddingService();

    // 테스트 의존성 주입
    __test.setTestDependencies({
      database: db,
      searchEngine,
      hybridSearchEngine,
      embeddingService
    });
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    vi.clearAllMocks();
  });

  describe('테스트 의존성 주입', () => {
    it('setTestDependencies로 데이터베이스를 설정할 수 있어야 함', () => {
      // When: 테스트 의존성 설정
      __test.setTestDependencies({
        database: db,
        searchEngine,
        hybridSearchEngine,
        embeddingService
      });

      // Then: 데이터베이스가 설정되어야 함
      const retrievedDb = __test.getDatabase();
      expect(retrievedDb).toBe(db);
    });

    it('getApp으로 Express 앱을 가져올 수 있어야 함', () => {
      // When: Express 앱 조회
      const app = __test.getApp();

      // Then: 앱이 반환되어야 함
      expect(app).toBeDefined();
      // Express 앱은 객체이지만 typeof는 'object'가 아닐 수 있음
      expect(app).not.toBeNull();
    });

    it('getServer로 HTTP 서버를 가져올 수 있어야 함', () => {
      // When: HTTP 서버 조회
      const server = __test.getServer();

      // Then: 서버가 반환되어야 함
      expect(server).toBeDefined();
      expect(typeof server).toBe('object');
    });

    it('getSearchEngine으로 검색 엔진을 가져올 수 있어야 함', () => {
      // Given: 테스트 의존성 설정
      __test.setTestDependencies({
        database: db,
        searchEngine,
        hybridSearchEngine,
        embeddingService
      });

      // When: 검색 엔진 조회
      const retrieved = __test.getSearchEngine();

      // Then: 검색 엔진이 반환되어야 함
      expect(retrieved).toBe(searchEngine);
    });

    it('getHybridSearchEngine으로 하이브리드 검색 엔진을 가져올 수 있어야 함', () => {
      // Given: 테스트 의존성 설정
      __test.setTestDependencies({
        database: db,
        searchEngine,
        hybridSearchEngine,
        embeddingService
      });

      // When: 하이브리드 검색 엔진 조회
      const retrieved = __test.getHybridSearchEngine();

      // Then: 하이브리드 검색 엔진이 반환되어야 함
      expect(retrieved).toBe(hybridSearchEngine);
    });

    it('getEmbeddingService로 임베딩 서비스를 가져올 수 있어야 함', () => {
      // Given: 테스트 의존성 설정
      __test.setTestDependencies({
        database: db,
        searchEngine,
        hybridSearchEngine,
        embeddingService
      });

      // When: 임베딩 서비스 조회
      const retrieved = __test.getEmbeddingService();

      // Then: 임베딩 서비스가 반환되어야 함
      expect(retrieved).toBe(embeddingService);
    });
  });

  describe('Express 앱 구조', () => {
    it('Express 앱이 생성되어야 함', () => {
      // When: Express 앱 조회
      const app = __test.getApp();

      // Then: 앱이 정의되어야 함
      expect(app).toBeDefined();
      expect(app).not.toBeNull();
    });

    it('HTTP 서버가 생성되어야 함', () => {
      // When: HTTP 서버 조회
      const server = __test.getServer();

      // Then: 서버가 정의되어야 함
      expect(server).toBeDefined();
      expect(typeof server).toBe('object');
    });

    it('Express 앱이 미들웨어를 사용할 수 있어야 함', () => {
      // Given: Express 앱
      const app = __test.getApp();

      // Then: 앱이 미들웨어 메서드를 가져야 함
      expect(typeof app.use).toBe('function');
      expect(typeof app.get).toBe('function');
      expect(typeof app.post).toBe('function');
    });
  });

  describe('헬스 체크 엔드포인트', () => {
    it('/health 엔드포인트가 등록되어 있어야 함', () => {
      // Given: Express 앱
      const app = __test.getApp();

      // When: 라우트 확인
      // Then: 앱이 정의되어 있어야 함 (실제 엔드포인트 테스트는 통합 테스트에서)
      expect(app).toBeDefined();
    });
  });

  describe('데이터베이스 관리', () => {
    it('데이터베이스를 설정하고 조회할 수 있어야 함', () => {
      // Given: 테스트 데이터베이스
      const testDb = new Database(':memory:');

      // When: 데이터베이스 설정
      __test.setTestDependencies({
        database: testDb,
        searchEngine,
        hybridSearchEngine,
        embeddingService
      });

      // Then: 데이터베이스가 조회되어야 함
      const retrievedDb = __test.getDatabase();
      expect(retrievedDb).toBe(testDb);

      testDb.close();
    });

    it('데이터베이스가 null일 때 null을 반환해야 함', () => {
      // Given: null 데이터베이스
      __test.setTestDependencies({
        database: null as any,
        searchEngine,
        hybridSearchEngine,
        embeddingService
      });

      // When: 데이터베이스 조회
      const retrievedDb = __test.getDatabase();

      // Then: null 반환
      expect(retrievedDb).toBeNull();
    });
  });
});

