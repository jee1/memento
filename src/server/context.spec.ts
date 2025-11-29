/**
 * context 테스트
 * 서버 컨텍스트 모듈 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServerContext, createToolContext } from '../context.js';
import type { ServerContext, ToolContext } from '../context.js';
import type { ServerServices } from '../bootstrap.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../test/helpers/test-database.js';
import { initializeServices } from '../bootstrap.js';

describe('context 모듈', () => {
  let db: Database.Database;
  let services: ServerServices;

  beforeEach(async () => {
    db = await setupTestDatabase();
    services = await initializeServices(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('createServerContext', () => {
    it('서버 컨텍스트를 생성해야 함', () => {
      // When: 서버 컨텍스트 생성
      const context = createServerContext(db, services);

      // Then: 컨텍스트가 생성되어야 함
      expect(context).toBeDefined();
      expect(context.db).toBe(db);
      expect(context.services).toBe(services);
    });

    it('데이터베이스와 서비스를 올바르게 포함해야 함', () => {
      // When: 서버 컨텍스트 생성
      const context = createServerContext(db, services);

      // Then: 데이터베이스와 서비스가 포함되어야 함
      expect(context.db).toBe(db);
      expect(context.services).toBe(services);
      expect(context.services.searchEngine).toBeDefined();
      expect(context.services.hybridSearchEngine).toBeDefined();
      expect(context.services.embeddingService).toBeDefined();
    });
  });

  describe('createToolContext', () => {
    it('ToolContext를 생성해야 함', () => {
      // Given: 서버 컨텍스트 생성
      const serverContext = createServerContext(db, services);

      // When: ToolContext 생성
      const toolContext = createToolContext(serverContext);

      // Then: ToolContext가 생성되어야 함
      expect(toolContext).toBeDefined();
      expect(toolContext.db).toBe(db);
      expect(toolContext.services).toBeDefined();
    });

    it('모든 서비스를 ToolContext에 포함해야 함', () => {
      // Given: 서버 컨텍스트 생성
      const serverContext = createServerContext(db, services);

      // When: ToolContext 생성
      const toolContext = createToolContext(serverContext);

      // Then: 모든 서비스가 포함되어야 함
      expect(toolContext.services.searchEngine).toBe(services.searchEngine);
      expect(toolContext.services.hybridSearchEngine).toBe(services.hybridSearchEngine);
      expect(toolContext.services.embeddingService).toBe(services.embeddingService);
      expect(toolContext.services.forgettingPolicyService).toBe(services.forgettingPolicyService);
      expect(toolContext.services.performanceMonitor).toBe(services.performanceMonitor);
      expect(toolContext.services.databaseOptimizer).toBe(services.databaseOptimizer);
      expect(toolContext.services.errorLoggingService).toBe(services.errorLoggingService);
      expect(toolContext.services.performanceAlertService).toBe(services.performanceAlertService);
      expect(toolContext.services.consolidationScoreService).toBe(services.consolidationScoreService);
      expect(toolContext.services.writeCoalescingManager).toBe(services.writeCoalescingManager);
      expect(toolContext.services.anchorManager).toBe(services.anchorManager);
    });

    it('데이터베이스를 올바르게 전달해야 함', () => {
      // Given: 서버 컨텍스트 생성
      const serverContext = createServerContext(db, services);

      // When: ToolContext 생성
      const toolContext = createToolContext(serverContext);

      // Then: 데이터베이스가 올바르게 전달되어야 함
      expect(toolContext.db).toBe(db);
      expect(toolContext.db).toBe(serverContext.db);
    });
  });

  describe('컨텍스트 일관성', () => {
    it('동일한 서비스로 여러 컨텍스트를 생성할 수 있어야 함', () => {
      // When: 여러 컨텍스트 생성
      const context1 = createServerContext(db, services);
      const context2 = createServerContext(db, services);
      const toolContext1 = createToolContext(context1);
      const toolContext2 = createToolContext(context2);

      // Then: 모든 컨텍스트가 올바르게 생성되어야 함
      expect(context1.db).toBe(context2.db);
      expect(context1.services).toBe(context2.services);
      expect(toolContext1.db).toBe(toolContext2.db);
      expect(toolContext1.services.searchEngine).toBe(toolContext2.services.searchEngine);
    });
  });
});

