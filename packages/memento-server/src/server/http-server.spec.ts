/**
 * HTTP Server 테스트
 * HTTP/WebSocket MCP 서버 통합 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  setupTestDatabase,
  cleanupTestDatabase,
  type TestDatabaseContext
} from './test/helpers/test-database.js';
import type { ServerServices } from '@memento/core';
import { __test, cleanup } from './http-server.js';

describe('HTTP Server', () => {
  let ctx: TestDatabaseContext | null = null;
  let db: Database.Database;
  let searchEngine: ServerServices['searchEngine'];
  let hybridSearchEngine: ServerServices['hybridSearchEngine'];
  let embeddingService: ServerServices['embeddingService'];

  beforeEach(async () => {
    ctx = await setupTestDatabase();
    db = ctx.db;
    searchEngine = ctx.services.searchEngine;
    hybridSearchEngine = ctx.services.hybridSearchEngine;
    embeddingService = ctx.services.embeddingService;

    __test.setTestDependencies({
      database: db,
      searchEngine,
      hybridSearchEngine,
      embeddingService
    });
  });

  afterEach(async () => {
    await cleanupTestDatabase(ctx);
    ctx = null;
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
    it('/health가 실제 HTTP에서 healthy 상태를 반환해야 함', async () => {
      const server = createServer(__test.getApp());
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const port = (server.address() as AddressInfo).port;
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        const body = await response.json() as { status?: string };

        expect(response.status).toBe(200);
        expect(body.status).toBe('healthy');
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
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

  describe('정리 경로', () => {
    it('cleanup이 batch scheduler 중지를 대기한 후 데이터베이스 유지보수를 중지해야 함', async () => {
      const runtimeDiagnosticsSamplerCleanup = vi.fn().mockResolvedValue(undefined);
      const runtimeDiagnosticsLogger = {
        writeEvent: vi.fn().mockResolvedValue(undefined)
      };
      let releaseBatchSchedulerStop!: () => void;
      const batchSchedulerStop = vi.fn(() => new Promise<void>((resolve) => {
        releaseBatchSchedulerStop = resolve;
      }));
      const walCheckpointStop = vi.fn().mockResolvedValue(undefined);
      const databaseLockStop = vi.fn();
      __test.setTestDependencies({
        database: null,
        serverServices: {
          ...ctx!.services,
          batchScheduler: { stop: batchSchedulerStop } as ServerServices['batchScheduler'],
          walCheckpointScheduler: { stop: walCheckpointStop } as ServerServices['walCheckpointScheduler'],
          databaseLockMonitor: { stop: databaseLockStop } as ServerServices['databaseLockMonitor'],
          runtimeDiagnosticsSamplerCleanup,
          runtimeDiagnosticsLogger
        }
      });

      const cleanupPromise = cleanup();
      await vi.waitFor(() => expect(batchSchedulerStop).toHaveBeenCalledTimes(1));

      expect(walCheckpointStop).not.toHaveBeenCalled();
      expect(databaseLockStop).not.toHaveBeenCalled();

      releaseBatchSchedulerStop();
      await cleanupPromise;

      expect(runtimeDiagnosticsSamplerCleanup).toHaveBeenCalledTimes(1);
      expect(walCheckpointStop).toHaveBeenCalledTimes(1);
      expect(databaseLockStop).toHaveBeenCalledTimes(1);
      expect(batchSchedulerStop.mock.invocationCallOrder[0])
        .toBeLessThan(walCheckpointStop.mock.invocationCallOrder[0]);
      expect(walCheckpointStop.mock.invocationCallOrder[0])
        .toBeLessThan(databaseLockStop.mock.invocationCallOrder[0]);
      expect(runtimeDiagnosticsLogger.writeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'server_cleanup_start',
          transport: 'http'
        })
      );
      expect(runtimeDiagnosticsLogger.writeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'server_cleanup_finish',
          transport: 'http'
        })
      );
    });
  });
});
