/**
 * context 테스트
 * 서버 컨텍스트 모듈 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServerContext, createToolContext } from './context.js';
import type { ServerServices } from '@memento/core';
import type Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase, type TestDatabaseContext } from './test/helpers/test-database.js';

describe('context 모듈', () => {
  let ctx: TestDatabaseContext | null = null;
  let db: Database.Database;
  let services: ServerServices;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
    db = ctx.db;
    services = ctx.services;
  });

  afterEach(async () => {
    await cleanupTestDatabase(ctx);
    ctx = null;
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

  describe('createToolContext 오버로드 (db, services)', () => {
    it('given: db와 services가 주어질 때, when: createToolContext(db, services)를 호출하면, then: ToolContext가 생성되어야 함', () => {
      // Given: db와 services가 주어짐
      // When: createToolContext(db, services) 호출
      const toolContext = createToolContext(db, services);

      // Then: ToolContext가 생성되어야 함
      expect(toolContext).toBeDefined();
      expect(toolContext.db).toBe(db);
      expect(toolContext.services).toBeDefined();
    });

    it('given: db와 services가 주어질 때, when: createToolContext(db, services)를 호출하면, then: 모든 서비스가 포함되어야 함', () => {
      // Given: db와 services가 주어짐
      // When: createToolContext(db, services) 호출
      const toolContext = createToolContext(db, services);

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
      expect(toolContext.services.failureDetector).toBe(services.failureDetector);
      expect(toolContext.services.reflexionWorker).toBe(services.reflexionWorker);
      expect(toolContext.services.metaMemoryService).toBe(services.metaMemoryService);
    });

    it('given: db와 services가 주어질 때, when: createToolContext(db, services)와 createToolContext(serverContext)를 호출하면, then: 동일한 ToolContext가 생성되어야 함', () => {
      // Given: db와 services가 주어짐
      // When: 두 가지 방식으로 ToolContext 생성
      const toolContext1 = createToolContext(db, services);
      const serverContext = createServerContext(db, services);
      const toolContext2 = createToolContext(serverContext);

      // Then: 동일한 ToolContext가 생성되어야 함
      expect(toolContext1.db).toBe(toolContext2.db);
      expect(toolContext1.services.searchEngine).toBe(toolContext2.services.searchEngine);
      expect(toolContext1.services.hybridSearchEngine).toBe(toolContext2.services.hybridSearchEngine);
      expect(toolContext1.services.embeddingService).toBe(toolContext2.services.embeddingService);
      expect(toolContext1.services.metaMemoryService).toBe(toolContext2.services.metaMemoryService);
    });
  });
});

