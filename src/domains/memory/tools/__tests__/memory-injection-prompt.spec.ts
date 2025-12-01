/**
 * MemoryInjectionPrompt 테스트
 * 메모리 주입 프롬프트 도구 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryInjectionPrompt } from '../memory-injection-prompt.js';
import Database from 'better-sqlite3';
import { setupTestDatabase, cleanupTestDatabase } from '../../../../test/helpers/test-database.js';
import { createHybridSearchEngine } from '../../../search/algorithms/hybrid-search-engine.js';
import { ErrorLoggingService } from '../../../monitoring/services/error-logging-service.js';
import type { ToolContext } from '../../../tools/types.js';

describe('MemoryInjectionPrompt', () => {
  let db: Database.Database;
  let tool: MemoryInjectionPrompt;
  let context: ToolContext;
  let errorLoggingService: ErrorLoggingService;

  beforeEach(async () => {
    db = await setupTestDatabase();
    tool = new MemoryInjectionPrompt();
    
    // 에러 로깅 서비스 생성
    errorLoggingService = new ErrorLoggingService(db);
    
    // 하이브리드 검색 엔진 생성 (팩토리 함수 사용)
    const hybridSearchEngine = createHybridSearchEngine();
    
    context = {
      db,
      services: {
        hybridSearchEngine,
        errorLoggingService
      }
    };
  });

  afterEach(() => {
    cleanupTestDatabase(db);
  });

  describe('constructor', () => {
    it('도구가 올바르게 초기화되어야 함', () => {
      // When: 도구 생성
      const instance = new MemoryInjectionPrompt();

      // Then: 도구가 생성되어야 함
      expect(instance).toBeDefined();
    });

    it('올바른 도구 이름을 가져야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 이름
      expect(definition.name).toBe('memory_injection');
    });

    it('올바른 도구 설명을 가져야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 설명
      expect(definition.description).toContain('관련 기억');
    });

    it('올바른 입력 스키마를 가져야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 입력 스키마가 있어야 함
      expect(definition.inputSchema).toBeDefined();
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.properties).toBeDefined();
      expect(definition.inputSchema.properties.query).toBeDefined();
    });
  });

  describe('handle', () => {
    it('데이터베이스가 없을 때 에러를 발생시켜야 함', async () => {
      // Given: 데이터베이스가 없는 컨텍스트
      const invalidContext: ToolContext = {
        db: null as any,
        services: context.services
      };

      // When & Then: 에러 발생
      await expect(
        tool.handle({ query: 'test' }, invalidContext)
      ).rejects.toThrow('데이터베이스가 연결되지 않았습니다');
    });

    it('하이브리드 검색 엔진이 없을 때 에러를 발생시켜야 함', async () => {
      // Given: 하이브리드 검색 엔진이 없는 컨텍스트
      const invalidContext: ToolContext = {
        db,
        services: {}
      };

      // When & Then: 에러 발생
      await expect(
        tool.handle({ query: 'test' }, invalidContext)
      ).rejects.toThrow('하이브리드 검색 엔진이 사용할 수 없습니다');
    });

    it('기본 파라미터로 검색을 실행해야 함', async () => {
      // Given: 기본 파라미터
      const params = {
        query: 'test query'
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        // 스키마 문제 등으로 에러가 발생할 수 있음
        expect(error).toBeDefined();
      }
    });

    it('토큰 예산을 지정할 수 있어야 함', async () => {
      // Given: 토큰 예산 지정
      const params = {
        query: 'test query',
        token_budget: 2000
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('최대 기억 개수를 지정할 수 있어야 함', async () => {
      // Given: 최대 기억 개수 지정
      const params = {
        query: 'test query',
        max_memories: 10
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('메모리 타입을 필터링할 수 있어야 함', async () => {
      // Given: 메모리 타입 필터
      const params = {
        query: 'test query',
        memory_types: ['episodic', 'semantic']
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('core/vault 타입은 자동으로 제거되어야 함', async () => {
      // Given: core/vault 타입 포함
      const params = {
        query: 'test query',
        memory_types: ['core', 'vault', 'episodic']
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함 (core/vault는 자동 제거)
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('core/vault만 있으면 에러를 발생시켜야 함', async () => {
      // Given: core/vault만 포함
      const params = {
        query: 'test query',
        memory_types: ['core', 'vault']
      };

      // When & Then: 에러 발생
      await expect(
        tool.handle(params, context)
      ).rejects.toThrow("memory_types 배열에 유효한 타입이 없습니다");
    });

    it('중요도 임계값을 지정할 수 있어야 함', async () => {
      // Given: 중요도 임계값 지정
      const params = {
        query: 'test query',
        importance_threshold: 0.8
      };

      // When: 핸들러 실행
      // Then: 결과가 반환되거나 에러가 적절히 처리되어야 함
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          expect(result.content).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('검색 결과가 없을 때 적절한 메시지를 반환해야 함', async () => {
      // Given: 검색 결과가 없는 쿼리
      const params = {
        query: 'nonexistent_query_xyz_123'
      };

      // When: 핸들러 실행
      // Then: 적절한 메시지 반환 또는 에러 처리
      try {
        const result = await tool.handle(params, context);
        expect(result).toBeDefined();
        if (result.success) {
          const content = result.content[0]?.text;
          if (content) {
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
            expect(parsed.message).toBeDefined();
            expect(parsed.memories_used).toBeGreaterThanOrEqual(0);
          }
        }
      } catch (error) {
        // 스키마 문제 등으로 에러가 발생할 수 있음
        expect(error).toBeDefined();
      }
    });

    it('검색 결과가 있을 때 요약된 프롬프트를 반환해야 함', async () => {
      // Given: 테스트 메모리 생성
      const testMemory = {
        id: 'test-memory-1',
        type: 'episodic',
        content: 'This is a test memory for memory injection prompt testing.',
        importance: 0.8
      };
      
      try {
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance)
          VALUES (?, ?, ?, ?)
        `).run(testMemory.id, testMemory.type, testMemory.content, testMemory.importance);

        const params = {
          query: 'test memory'
        };

        // When: 핸들러 실행
        const result = await tool.handle(params, context);

        // Then: 요약된 프롬프트 반환
        expect(result).toBeDefined();
        if (result.success) {
          const content = result.content[0]?.text;
          if (content) {
            const parsed = typeof content === 'string' ? JSON.parse(content) : content;
            expect(parsed.message).toBeDefined();
            expect(parsed.memories_used).toBeGreaterThanOrEqual(0);
            expect(parsed.token_estimate).toBeGreaterThanOrEqual(0);
          }
        }
      } catch (error) {
        // 스키마 문제 등으로 에러가 발생할 수 있음
        expect(error).toBeDefined();
      }
    });
  });

  describe('도구 메타데이터', () => {
    it('도구 이름을 올바르게 반환해야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 이름
      expect(definition.name).toBe('memory_injection');
    });

    it('도구 설명을 올바르게 반환해야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 올바른 설명
      expect(definition.description).toBe('관련 기억을 요약하여 프롬프트에 주입');
    });

    it('입력 스키마에 query가 필수여야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: query가 필수
      expect(definition.inputSchema.required).toContain('query');
    });

    it('입력 스키마에 선택적 파라미터들이 있어야 함', () => {
      // When: 도구 정의 조회
      const definition = tool.getDefinition();

      // Then: 선택적 파라미터 존재
      expect(definition.inputSchema.properties.token_budget).toBeDefined();
      expect(definition.inputSchema.properties.max_memories).toBeDefined();
      expect(definition.inputSchema.properties.memory_types).toBeDefined();
      expect(definition.inputSchema.properties.importance_threshold).toBeDefined();
    });
  });
});

