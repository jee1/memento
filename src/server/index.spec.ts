/**
 * index.ts 테스트
 * MCP 서버 진입점 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../test/helpers/test-database.js';
import { initializeServices, type ServerServices } from './bootstrap.js';
import { getToolRegistry } from '../tools/index.js';
import { createToolContext } from './context.js';
import { createServerContext } from './context.js';

describe('MCP 서버 진입점', () => {
  let db: Database.Database;
  let services: ServerServices;

  beforeEach(async () => {
    db = await setupTestDatabase();
    services = await initializeServices(db);
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('서비스 초기화', () => {
    it('데이터베이스와 서비스를 초기화할 수 있어야 함', async () => {
      // When: 서비스 초기화
      const initializedServices = await initializeServices(db);

      // Then: 모든 서비스가 초기화되어야 함
      expect(initializedServices).toBeDefined();
      expect(initializedServices.searchEngine).toBeDefined();
      expect(initializedServices.hybridSearchEngine).toBeDefined();
      expect(initializedServices.embeddingService).toBeDefined();
      expect(initializedServices.forgettingPolicyService).toBeDefined();
      expect(initializedServices.performanceMonitor).toBeDefined();
      expect(initializedServices.databaseOptimizer).toBeDefined();
      expect(initializedServices.errorLoggingService).toBeDefined();
      expect(initializedServices.performanceAlertService).toBeDefined();
      expect(initializedServices.anchorManager).toBeDefined();
    });
  });

  describe('도구 레지스트리', () => {
    it('도구 레지스트리를 가져올 수 있어야 함', () => {
      // When: 도구 레지스트리 가져오기
      const registry = getToolRegistry();

      // Then: 레지스트리가 반환되어야 함
      expect(registry).toBeDefined();
      expect(typeof registry.getAll).toBe('function');
      expect(typeof registry.get).toBe('function');
    });

    it('핵심 도구들이 등록되어 있어야 함', () => {
      // Given: 도구 레지스트리
      const registry = getToolRegistry();

      // When: 모든 도구 조회
      const allTools = registry.getAll();

      // Then: 핵심 도구들이 등록되어 있어야 함
      const toolNames = allTools.map(tool => tool.name);
      expect(toolNames).toContain('remember');
      expect(toolNames).toContain('recall');
      expect(toolNames).toContain('forget');
      expect(toolNames).toContain('pin');
      expect(toolNames).toContain('unpin');
    });
  });

  describe('ToolContext 생성', () => {
    it('서버 컨텍스트로부터 ToolContext를 생성할 수 있어야 함', () => {
      // Given: 서버 컨텍스트 생성
      const serverContext = createServerContext(db, services);

      // When: ToolContext 생성
      const toolContext = createToolContext(serverContext);

      // Then: ToolContext가 생성되어야 함
      expect(toolContext).toBeDefined();
      expect(toolContext.db).toBe(db);
      expect(toolContext.services).toBeDefined();
    });

    it('ToolContext에 모든 서비스가 포함되어야 함', () => {
      // Given: 서버 컨텍스트 생성
      const serverContext = createServerContext(db, services);

      // When: ToolContext 생성
      const toolContext = createToolContext(serverContext);

      // Then: 모든 서비스가 포함되어야 함
      expect(toolContext.services.searchEngine).toBeDefined();
      expect(toolContext.services.hybridSearchEngine).toBeDefined();
      expect(toolContext.services.embeddingService).toBeDefined();
      expect(toolContext.services.forgettingPolicyService).toBeDefined();
      expect(toolContext.services.performanceMonitor).toBeDefined();
      expect(toolContext.services.databaseOptimizer).toBeDefined();
      expect(toolContext.services.errorLoggingService).toBeDefined();
      expect(toolContext.services.performanceAlertService).toBeDefined();
      expect(toolContext.services.anchorManager).toBeDefined();
    });
  });

  describe('도구 실행 준비', () => {
    it('도구를 실행할 수 있는 환경이 준비되어야 함', async () => {
      // Given: 서버 컨텍스트 및 ToolContext 생성
      const serverContext = createServerContext(db, services);
      const toolContext = createToolContext(serverContext);
      const registry = getToolRegistry();

      // When: 도구 조회
      const rememberTool = registry.get('remember');

      // Then: 도구가 조회되고 실행 가능해야 함
      expect(rememberTool).toBeDefined();
      expect(rememberTool?.handler).toBeDefined();
      expect(typeof rememberTool?.handler).toBe('function');
    });

    it('도구 핸들러가 ToolContext를 받을 수 있어야 함', async () => {
      // Given: 서버 컨텍스트 및 ToolContext 생성
      const serverContext = createServerContext(db, services);
      const toolContext = createToolContext(serverContext);
      const registry = getToolRegistry();
      const rememberTool = registry.get('remember');

      // When: 도구 핸들러 호출 (실제 실행은 하지 않고 구조만 확인)
      if (rememberTool) {
        // Then: 핸들러가 함수여야 함
        expect(typeof rememberTool.handler).toBe('function');
        // 핸들러가 ToolContext를 받을 수 있는지 확인
        expect(rememberTool.handler.length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});

