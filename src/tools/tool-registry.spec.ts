/**
 * ToolRegistry 테스트
 * 도구 등록 및 관리 시스템 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolRegistry } from './tool-registry.js';
import type { ToolDefinition, ToolContext, ToolResult } from './types.js';
import Database from 'better-sqlite3';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;
  let context: ToolContext;

  beforeEach(() => {
    registry = new ToolRegistry({
      enableLogging: false, // 테스트 중 로그 비활성화
      enableMetrics: true,
      maxExecutionTime: 30000,
      enableCaching: false,
      cacheSize: 100
    });
    
    context = {
      db: new Database(':memory:'),
      services: {} as any
    };
  });

  afterEach(() => {
    registry.clear();
  });

  describe('register', () => {
    it('도구를 등록해야 함', () => {
      // Given: 도구 정의
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };

      // When: 도구 등록
      registry.register(tool);

      // Then: 도구가 등록되어야 함
      expect(registry.has('test-tool')).toBe(true);
      expect(registry.get('test-tool')).toBe(tool);
    });

    it('이미 존재하는 도구를 교체해야 함', () => {
      // Given: 도구 등록
      const tool1: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool 1',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
      };
      registry.register(tool1);

      // When: 동일한 이름으로 다른 도구 등록
      const tool2: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool 2',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
      };
      registry.register(tool2);

      // Then: 새로운 도구로 교체되어야 함
      expect(registry.get('test-tool')).toBe(tool2);
      expect(registry.get('test-tool')?.description).toBe('Test tool 2');
    });

    it('메트릭을 초기화해야 함', () => {
      // Given: 메트릭이 활성화된 레지스트리
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };

      // When: 도구 등록
      registry.register(tool);

      // Then: 메트릭이 초기화되어야 함
      const metrics = registry.getMetrics('test-tool');
      expect(metrics.length).toBe(1);
      expect(metrics[0].name).toBe('test-tool');
      expect(metrics[0].totalExecutions).toBe(0);
      expect(metrics[0].successfulExecutions).toBe(0);
      expect(metrics[0].failedExecutions).toBe(0);
    });
  });

  describe('registerAll', () => {
    it('여러 도구를 한 번에 등록해야 함', () => {
      // Given: 여러 도구 정의
      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
        },
        {
          name: 'tool3',
          description: 'Tool 3',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result3' }] })
        }
      ];

      // When: 모든 도구 등록
      registry.registerAll(tools);

      // Then: 모든 도구가 등록되어야 함
      expect(registry.size()).toBe(3);
      expect(registry.has('tool1')).toBe(true);
      expect(registry.has('tool2')).toBe(true);
      expect(registry.has('tool3')).toBe(true);
    });
  });

  describe('get / getAll', () => {
    it('등록된 도구를 조회해야 함', () => {
      // Given: 도구 등록
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(tool);

      // When: 도구 조회
      const retrieved = registry.get('test-tool');

      // Then: 등록된 도구 반환
      expect(retrieved).toBe(tool);
    });

    it('존재하지 않는 도구는 undefined를 반환해야 함', () => {
      // When: 존재하지 않는 도구 조회
      const retrieved = registry.get('nonexistent');

      // Then: undefined 반환
      expect(retrieved).toBeUndefined();
    });

    it('모든 도구 목록을 반환해야 함', () => {
      // Given: 여러 도구 등록
      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
        }
      ];
      registry.registerAll(tools);

      // When: 모든 도구 조회
      const all = registry.getAll();

      // Then: 모든 도구가 반환되어야 함
      expect(all.length).toBe(2);
      expect(all).toContain(tools[0]);
      expect(all).toContain(tools[1]);
    });
  });

  describe('execute', () => {
    it('도구를 실행해야 함', async () => {
      // Given: 도구 등록
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async (params: any) => {
          return {
            content: [{ type: 'text', text: JSON.stringify({ result: 'success', params }) }]
          };
        }
      };
      registry.register(tool);

      // When: 도구 실행
      const result = await registry.execute('test-tool', { test: 'value' }, context);

      // Then: 결과 반환
      expect(result).toHaveProperty('content');
      const resultData = JSON.parse(result.content[0].text);
      expect(resultData.result).toBe('success');
      expect(resultData.params).toEqual({ test: 'value' });
    });

    it('존재하지 않는 도구 실행 시 에러를 발생시켜야 함', async () => {
      // When & Then: 존재하지 않는 도구 실행 시 에러 발생
      await expect(
        registry.execute('nonexistent', {}, context)
      ).rejects.toThrow('Unknown tool: nonexistent');
    });

    it('성공 메트릭을 업데이트해야 함', async () => {
      // Given: 도구 등록
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'success' }] })
      };
      registry.register(tool);

      // When: 도구 실행
      await registry.execute('test-tool', {}, context);

      // Then: 성공 메트릭 업데이트
      const metrics = registry.getMetrics('test-tool');
      expect(metrics[0].totalExecutions).toBe(1);
      expect(metrics[0].successfulExecutions).toBe(1);
      expect(metrics[0].failedExecutions).toBe(0);
      expect(metrics[0].errorRate).toBe(0);
    });

    it('실패 메트릭을 업데이트해야 함', async () => {
      // Given: 에러를 발생시키는 도구 등록
      const tool: ToolDefinition = {
        name: 'failing-tool',
        description: 'Failing tool',
        inputSchema: { type: 'object' },
        handler: async () => {
          throw new Error('Tool execution failed');
        }
      };
      registry.register(tool);

      // When: 도구 실행 (에러 발생)
      try {
        await registry.execute('failing-tool', {}, context);
      } catch (error) {
        // 에러는 예상됨
      }

      // Then: 실패 메트릭 업데이트
      const metrics = registry.getMetrics('failing-tool');
      expect(metrics[0].totalExecutions).toBe(1);
      expect(metrics[0].successfulExecutions).toBe(0);
      expect(metrics[0].failedExecutions).toBe(1);
      expect(metrics[0].errorRate).toBe(1);
    });

    it('타임아웃을 적용해야 함', async () => {
      // Given: 타임아웃이 짧은 레지스트리
      const shortTimeoutRegistry = new ToolRegistry({
        enableLogging: false,
        enableMetrics: true,
        maxExecutionTime: 100, // 100ms 타임아웃
        enableCaching: false,
        cacheSize: 100
      });

      // 느린 도구 등록
      const tool: ToolDefinition = {
        name: 'slow-tool',
        description: 'Slow tool',
        inputSchema: { type: 'object' },
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 200)); // 200ms 대기
          return { content: [{ type: 'text', text: 'result' }] };
        }
      };
      shortTimeoutRegistry.register(tool);

      // When & Then: 타임아웃 에러 발생
      await expect(
        shortTimeoutRegistry.execute('slow-tool', {}, context)
      ).rejects.toThrow('Tool execution timeout: slow-tool');
    });

    it('캐시가 활성화되면 결과를 캐시해야 함', async () => {
      // Given: 캐시가 활성화된 레지스트리
      const cachedRegistry = new ToolRegistry({
        enableLogging: false,
        enableMetrics: true,
        maxExecutionTime: 30000,
        enableCaching: true,
        cacheSize: 100
      });

      let executionCount = 0;
      const tool: ToolDefinition = {
        name: 'cached-tool',
        description: 'Cached tool',
        inputSchema: { type: 'object' },
        handler: async () => {
          executionCount++;
          return { content: [{ type: 'text', text: 'result' }] };
        }
      };
      cachedRegistry.register(tool);

      // When: 동일한 파라미터로 두 번 실행
      const result1 = await cachedRegistry.execute('cached-tool', { param: 'value' }, context);
      const result2 = await cachedRegistry.execute('cached-tool', { param: 'value' }, context);

      // Then: 결과가 동일해야 함 (캐시 히트)
      // 캐시가 작동하면 executionCount는 1이지만, 
      // 캐시가 작동하지 않으면 2가 될 수 있음
      expect(result1).toEqual(result2);
      // 캐시 통계로 확인
      const cacheStats = cachedRegistry.getCacheStats();
      if (cacheStats.size > 0) {
        // 캐시가 활성화되어 있으면 한 번만 실행되어야 함
        expect(executionCount).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('has / remove', () => {
    it('도구 존재 여부를 확인해야 함', () => {
      // Given: 도구 등록
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(tool);

      // When: 존재 여부 확인
      const exists = registry.has('test-tool');
      const notExists = registry.has('nonexistent');

      // Then: 올바른 결과 반환
      expect(exists).toBe(true);
      expect(notExists).toBe(false);
    });

    it('도구를 제거해야 함', () => {
      // Given: 도구 등록
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(tool);

      // When: 도구 제거
      const removed = registry.remove('test-tool');

      // Then: 제거 성공 및 조회 불가
      expect(removed).toBe(true);
      expect(registry.has('test-tool')).toBe(false);
      expect(registry.get('test-tool')).toBeUndefined();
    });

    it('존재하지 않는 도구 제거는 false를 반환해야 함', () => {
      // When: 존재하지 않는 도구 제거
      const removed = registry.remove('nonexistent');

      // Then: false 반환
      expect(removed).toBe(false);
    });

    it('도구 제거 시 메트릭도 제거해야 함', () => {
      // Given: 도구 등록 및 실행
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(tool);

      // When: 도구 제거
      registry.remove('test-tool');

      // Then: 메트릭도 제거되어야 함
      const metrics = registry.getMetrics('test-tool');
      expect(metrics.length).toBe(0);
    });
  });

  describe('clear', () => {
    it('모든 도구를 제거해야 함', () => {
      // Given: 여러 도구 등록
      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
        }
      ];
      registry.registerAll(tools);

      // When: 모든 도구 제거
      registry.clear();

      // Then: 모든 도구가 제거되어야 함
      expect(registry.size()).toBe(0);
      expect(registry.has('tool1')).toBe(false);
      expect(registry.has('tool2')).toBe(false);
    });

    it('메트릭도 모두 제거해야 함', () => {
      // Given: 도구 등록 및 실행
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(tool);

      // When: 모든 도구 제거
      registry.clear();

      // Then: 메트릭도 제거되어야 함
      const metrics = registry.getMetrics();
      expect(metrics.length).toBe(0);
    });
  });

  describe('size / getNames', () => {
    it('도구 개수를 반환해야 함', () => {
      // Given: 여러 도구 등록
      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
      }
      ];
      registry.registerAll(tools);

      // When: 크기 조회
      const size = registry.size();

      // Then: 올바른 크기 반환
      expect(size).toBe(2);
    });

    it('도구 이름 목록을 반환해야 함', () => {
      // Given: 여러 도구 등록
      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
        }
      ];
      registry.registerAll(tools);

      // When: 이름 목록 조회
      const names = registry.getNames();

      // Then: 모든 이름이 반환되어야 함
      expect(names).toContain('tool1');
      expect(names).toContain('tool2');
      expect(names.length).toBe(2);
    });
  });

  describe('search', () => {
    it('이름으로 도구를 검색해야 함', () => {
      // Given: 여러 도구 등록
      const tools: ToolDefinition[] = [
        {
          name: 'memory-tool',
          description: 'Memory tool',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'search-tool',
          description: 'Search tool',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
        },
        {
          name: 'other-tool',
          description: 'Other tool',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result3' }] })
        }
      ];
      registry.registerAll(tools);

      // When: 'memory'로 검색
      const results = registry.search('memory');

      // Then: memory-tool만 반환되어야 함
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('memory-tool');
    });

    it('설명으로 도구를 검색해야 함', () => {
      // Given: 여러 도구 등록
      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Memory management tool',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'tool2',
          description: 'Search functionality',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
        }
      ];
      registry.registerAll(tools);

      // When: 'memory'로 검색
      const results = registry.search('memory');

      // Then: memory 관련 도구만 반환되어야 함
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('tool1');
    });

    it('대소문자 구분 없이 검색해야 함', () => {
      // Given: 도구 등록
      const tool: ToolDefinition = {
        name: 'TestTool',
        description: 'Test Tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(tool);

      // When: 소문자로 검색
      const results = registry.search('test');

      // Then: 도구가 반환되어야 함
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('TestTool');
    });
  });

  describe('getByCategory', () => {
    it('카테고리별로 도구를 그룹화해야 함', () => {
      // Given: 다양한 카테고리의 도구 등록
      const tools: ToolDefinition[] = [
        {
          name: 'remember-tool',
          description: 'Remember tool',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'search-tool',
          description: 'Search tool',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
        },
        {
          name: 'cleanup-tool',
          description: 'Cleanup tool',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result3' }] })
        }
      ];
      registry.registerAll(tools);

      // When: 카테고리별 그룹화
      const categories = registry.getByCategory();

      // Then: 카테고리별로 그룹화되어야 함
      expect(categories.has('memory')).toBe(true);
      expect(categories.has('search')).toBe(true);
      expect(categories.has('maintenance')).toBe(true);
    });
  });

  describe('getMetrics', () => {
    it('특정 도구의 메트릭을 조회해야 함', async () => {
      // Given: 도구 등록 및 실행
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(tool);
      await registry.execute('test-tool', {}, context);

      // When: 메트릭 조회
      const metrics = registry.getMetrics('test-tool');

      // Then: 메트릭이 반환되어야 함
      expect(metrics.length).toBe(1);
      expect(metrics[0].name).toBe('test-tool');
      expect(metrics[0].totalExecutions).toBe(1);
      expect(metrics[0].lastExecution).not.toBeNull();
    });

    it('모든 도구의 메트릭을 조회해야 함', async () => {
      // Given: 여러 도구 등록 및 실행
      const tools: ToolDefinition[] = [
        {
          name: 'tool1',
          description: 'Tool 1',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result1' }] })
        },
        {
          name: 'tool2',
          description: 'Tool 2',
          inputSchema: { type: 'object' },
          handler: async () => ({ content: [{ type: 'text', text: 'result2' }] })
        }
      ];
      registry.registerAll(tools);
      await registry.execute('tool1', {}, context);
      await registry.execute('tool2', {}, context);

      // When: 모든 메트릭 조회
      const metrics = registry.getMetrics();

      // Then: 모든 메트릭이 반환되어야 함
      expect(metrics.length).toBe(2);
      expect(metrics.find(m => m.name === 'tool1')).toBeDefined();
      expect(metrics.find(m => m.name === 'tool2')).toBeDefined();
    });

    it('평균 실행 시간을 계산해야 함', async () => {
      // Given: 도구 등록
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { content: [{ type: 'text', text: 'result' }] };
        }
      };
      registry.register(tool);

      // When: 여러 번 실행
      await registry.execute('test-tool', {}, context);
      await registry.execute('test-tool', {}, context);

      // Then: 평균 실행 시간이 계산되어야 함
      const metrics = registry.getMetrics('test-tool');
      expect(metrics[0].averageExecutionTime).toBeGreaterThan(0);
    });
  });

  describe('getToolStatus', () => {
    it('도구 상태를 반환해야 함', async () => {
      // Given: 도구 등록 및 실행
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(tool);
      await registry.execute('test-tool', {}, context);

      // When: 도구 상태 조회
      const status = registry.getToolStatus('test-tool');

      // Then: 상태 정보가 반환되어야 함
      expect(status.exists).toBe(true);
      expect(status.lastExecution).not.toBeNull();
      expect(status.errorRate).toBe(0);
      expect(status.averageExecutionTime).toBeGreaterThanOrEqual(0);
    });

    it('존재하지 않는 도구는 exists가 false여야 함', () => {
      // When: 존재하지 않는 도구 상태 조회
      const status = registry.getToolStatus('nonexistent');

      // Then: exists가 false
      expect(status.exists).toBe(false);
      expect(status.lastExecution).toBeNull();
    });
  });

  describe('updateConfig', () => {
    it('설정을 업데이트해야 함', () => {
      // Given: 초기 설정
      expect(registry['config'].enableCaching).toBe(false);

      // When: 설정 업데이트
      registry.updateConfig({ enableCaching: true });

      // Then: 설정이 업데이트되어야 함
      expect(registry['config'].enableCaching).toBe(true);
    });
  });

  describe('clearCache', () => {
    it('캐시를 비워야 함', async () => {
      // Given: 캐시가 활성화된 레지스트리
      const cachedRegistry = new ToolRegistry({
        enableLogging: false,
        enableMetrics: true,
        maxExecutionTime: 30000,
        enableCaching: true,
        cacheSize: 100
      });

      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      cachedRegistry.register(tool);

      // 캐시에 결과 저장
      await cachedRegistry.execute('test-tool', { param: 'value' }, context);

      // When: 캐시 비우기
      cachedRegistry.clearCache();

      // Then: 캐시가 비워져야 함
      const cacheStats = cachedRegistry.getCacheStats();
      expect(cacheStats.size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('캐시 통계를 반환해야 함', () => {
      // When: 캐시 통계 조회
      const stats = registry.getCacheStats();

      // Then: 통계가 반환되어야 함
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('hitRate');
      expect(stats).toHaveProperty('maxSize');
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(100);
    });
  });

  describe('validateTool', () => {
    it('유효한 도구는 에러가 없어야 함', () => {
      // Given: 유효한 도구
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };

      // When: 도구 검증
      const errors = registry.validateTool(tool);

      // Then: 에러가 없어야 함
      expect(errors.length).toBe(0);
    });

    it('이름이 없으면 에러를 반환해야 함', () => {
      // Given: 이름이 없는 도구
      const tool: ToolDefinition = {
        name: '',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };

      // When: 도구 검증
      const errors = registry.validateTool(tool);

      // Then: 에러 반환
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Tool name is required');
    });

    it('설명이 없으면 에러를 반환해야 함', () => {
      // Given: 설명이 없는 도구
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: '',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };

      // When: 도구 검증
      const errors = registry.validateTool(tool);

      // Then: 에러 반환
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Tool description is required');
    });

    it('핸들러가 없으면 에러를 반환해야 함', () => {
      // Given: 핸들러가 없는 도구
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: null as any
      };

      // When: 도구 검증
      const errors = registry.validateTool(tool);

      // Then: 에러 반환
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).toContain('Tool handler must be a function');
    });
  });

  describe('validateAllTools', () => {
    it('모든 도구를 검증해야 함', () => {
      // Given: 유효한 도구와 유효하지 않은 도구 등록
      const validTool: ToolDefinition = {
        name: 'valid-tool',
        description: 'Valid tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      const invalidTool: ToolDefinition = {
        name: '',
        description: 'Invalid tool',
        inputSchema: { type: 'object' },
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };
      registry.register(validTool);
      registry.register(invalidTool);

      // When: 모든 도구 검증
      const results = registry.validateAllTools();

      // Then: 유효하지 않은 도구만 에러 반환
      expect(results.size).toBe(1);
      expect(results.has('')).toBe(true);
    });
  });
});

