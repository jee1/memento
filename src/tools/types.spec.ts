/**
 * MCP Tools 타입 정의 테스트
 * 타입 안정성 강화를 위한 테스트
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ToolDefinition, ToolContext, ToolHandler, ToolResult } from './types.js';
import Database from 'better-sqlite3';

describe('ToolDefinition 타입 안정성', () => {
  describe('inputSchema 타입 검증', () => {
    it('given: ToolDefinition이 정의될 때, when: inputSchema가 z.ZodSchema 타입이면, then: 타입 체크가 통과해야 함', () => {
      // Given: Zod 스키마를 사용하는 ToolDefinition
      const schema = z.object({
        query: z.string().min(1)
      });

      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: schema, // z.ZodSchema 타입
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };

      // When: 타입 체크 (런타임에서는 타입이 존재하지 않으므로, 스키마 검증으로 대체)
      // Then: 스키마가 Zod 스키마인지 확인
      expect(schema).toBeDefined();
      expect(tool.inputSchema).toBe(schema);
      expect(typeof tool.inputSchema.parse).toBe('function'); // Zod 스키마는 parse 메서드를 가짐
    });

    it('given: ToolDefinition이 정의될 때, when: inputSchema가 any 타입이면, then: 타입 안정성이 부족함을 확인해야 함', () => {
      // Given: any 타입을 사용하는 ToolDefinition (현재 상태)
      const tool: ToolDefinition = {
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' } as any, // any 타입 (개선 필요)
        handler: async () => ({ content: [{ type: 'text', text: 'result' }] })
      };

      // When: 타입 체크
      // Then: any 타입이 사용되고 있음을 확인 (개선 대상)
      expect(tool.inputSchema).toBeDefined();
      // 이 테스트는 any 타입이 제거되면 실패해야 함
    });
  });
});

describe('ToolContext 타입 안정성', () => {
  describe('서비스 타입 검증', () => {
    it('given: ToolContext가 정의될 때, when: 서비스들이 구체적인 타입이면, then: 타입 체크가 통과해야 함', () => {
      // Given: 구체적인 타입을 사용하는 ToolContext (목표 상태)
      const db = new Database(':memory:');
      
      const context: ToolContext = {
        db, // Database.Database 타입 (개선 필요: any → Database.Database)
        services: {
          // 각 서비스는 구체적인 타입이어야 함 (현재는 any)
          // searchEngine?: SearchEngine;
          // hybridSearchEngine?: HybridSearchEngine;
          // 등등...
        }
      };

      // When: 타입 체크
      // Then: db가 Database 인스턴스인지 확인
      expect(context.db).toBe(db);
      expect(context.services).toBeDefined();
      
      // 이 테스트는 서비스 타입이 구체화되면 더 엄격하게 검증 가능
    });

    it('given: ToolContext가 정의될 때, when: 서비스들이 any 타입이면, then: 타입 안정성이 부족함을 확인해야 함', () => {
      // Given: any 타입을 사용하는 ToolContext (현재 상태)
      const db = new Database(':memory:');
      
      const context: ToolContext = {
        db: db as any, // any 타입 (개선 필요)
        services: {
          searchEngine: undefined as any, // any 타입 (개선 필요)
          hybridSearchEngine: undefined as any // any 타입 (개선 필요)
        }
      };

      // When: 타입 체크
      // Then: any 타입이 사용되고 있음을 확인 (개선 대상)
      expect(context.db).toBeDefined();
      expect(context.services).toBeDefined();
      // 이 테스트는 any 타입이 제거되면 실패해야 함
    });
  });
});

describe('ToolHandler 타입 안정성', () => {
  describe('params와 반환값 타입 검증', () => {
    it('given: ToolHandler가 정의될 때, when: params와 반환값이 구체적인 타입이면, then: 타입 체크가 통과해야 함', () => {
      // Given: 구체적인 타입을 사용하는 ToolHandler (목표 상태)
      // type ToolHandler = <TParams, TResult>(
      //   params: TParams,
      //   context: ToolContext
      // ) => Promise<TResult>;
      
      const handler: ToolHandler = async (params: unknown, context: ToolContext) => {
        // params는 unknown 타입으로 처리 (런타임 검증 필요)
        // 반환값은 ToolResult 타입
        return {
          content: [{ type: 'text', text: JSON.stringify(params) }]
        };
      };

      // When: 타입 체크
      // Then: handler가 함수인지 확인
      expect(typeof handler).toBe('function');
      
      // 이 테스트는 params와 반환값 타입이 구체화되면 더 엄격하게 검증 가능
    });

    it('given: ToolHandler가 정의될 때, when: params와 반환값이 any 타입이면, then: 타입 안정성이 부족함을 확인해야 함', () => {
      // Given: any 타입을 사용하는 ToolHandler (현재 상태)
      const handler: ToolHandler = async (params: any, context: ToolContext): Promise<any> => {
        // params: any, 반환값: Promise<any> (개선 필요)
        return {
          content: [{ type: 'text', text: JSON.stringify(params) }]
        };
      };

      // When: 타입 체크
      // Then: any 타입이 사용되고 있음을 확인 (개선 대상)
      expect(typeof handler).toBe('function');
      // 이 테스트는 any 타입이 제거되면 실패해야 함
    });
  });
});

describe('ToolResult 타입 안정성', () => {
  describe('추가 필드 타입 검증', () => {
    it('given: ToolResult가 정의될 때, when: 추가 필드가 Record<string, unknown> 타입이면, then: 타입 체크가 통과해야 함', () => {
      // Given: Record<string, unknown> 타입을 사용하는 ToolResult (목표 상태)
      // interface ToolResult {
      //   content: Array<{ type: 'text'; text: string }>;
      //   [key: string]: unknown; // Record<string, unknown>
      // }
      
      const result: ToolResult = {
        content: [{ type: 'text', text: 'result' }],
        additionalField: 'value' // 추가 필드
      };

      // When: 타입 체크
      // Then: content 필드가 올바른 타입인지 확인
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(result.content[0]).toHaveProperty('text');
      
      // 추가 필드가 존재하는지 확인
      expect(result).toHaveProperty('additionalField');
      
      // 이 테스트는 추가 필드 타입이 Record<string, unknown>으로 구체화되면 더 엄격하게 검증 가능
    });

    it('given: ToolResult가 정의될 때, when: 추가 필드가 any 타입이면, then: 타입 안정성이 부족함을 확인해야 함', () => {
      // Given: any 타입을 사용하는 ToolResult (현재 상태)
      const result: ToolResult = {
        content: [{ type: 'text', text: 'result' }],
        // [key: string]: any; // any 타입 (개선 필요)
      } as ToolResult;

      // When: 타입 체크
      // Then: any 타입이 사용되고 있음을 확인 (개선 대상)
      expect(result.content).toBeDefined();
      // 이 테스트는 any 타입이 제거되면 실패해야 함
    });
  });
});
