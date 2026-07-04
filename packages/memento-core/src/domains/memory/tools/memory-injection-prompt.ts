/**
 * Memory Injection 프롬프트 도구
 * MCP 프롬프트 인터페이스를 통한 관련 기억 주입
 */

import { z } from 'zod';
import { mementoConfig } from '../../../shared/config/index.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { BaseTool } from '../../../tools/base-tool.js';
import { CommonSchemas, type ToolContext, type ToolResult } from '../../../tools/types.js';
import { buildKnowledgeContextBundle } from '../services/knowledge-context-bundle-builder.js';
import { normalizeMemoryTypesForHybridItemSearch } from '../utils/normalize-memory-types-for-item-search.js';
import { handleAutoSetAnchor } from './recall-tool-anchor-rotation.js';
import type { RecallToolHost } from './recall-tool-host.js';

const MemoryInjectionSchema = z.object({
  query: z.string().describe('검색할 내용을 자연어 문장으로 입력하세요. 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다.'),
  token_budget: z.number().optional().describe('토큰 예산 (기본값: 1000)'),
  max_memories: z.number().optional().describe('최대 기억 개수 (기본값: 5)'),
  memory_types: z.array(CommonSchemas.MemoryType).optional().describe('포함할 기억 타입들'),
  importance_threshold: z.number().optional().describe('중요도 임계값 (기본값: 0.5)'),
  // Project-scoped memory (Issue #81)
  project_id: z.string().max(200).optional()
    .describe('지정 시 해당 프로젝트 기억만 주입. 미지정 시 전체 기억에서 검색'),
  owner_id: z.union([z.string(), z.array(z.string())]).optional()
    .describe('소유자(owner) 범위로 결과를 제한합니다. 미지정 시 owner 필터를 적용하지 않습니다.')
});

export class MemoryInjectionPrompt extends BaseTool {
  constructor() {
    super(
      'memory_injection',
      '관련 기억을 요약하여 프롬프트에 주입',
      {
        type: 'object',
        properties: {
          query: { 
            type: 'string', 
            description: '검색할 내용을 자연어 문장으로 입력하세요. 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다.' 
          },
          token_budget: { 
            type: 'number', 
            description: '토큰 예산 (기본값: 1000)',
            default: 1000
          },
          max_memories: { 
            type: 'number', 
            description: '최대 기억 개수 (기본값: 5)',
            default: 5
          },
          memory_types: { 
            type: 'array',
            items: {
              type: 'string',
              enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault']
            },
            description: '포함할 기억 타입들 (core/vault는 자동으로 제거됩니다)',
            default: ['working', 'episodic', 'semantic', 'procedural']
          },
          importance_threshold: {
            type: 'number',
            description: '중요도 임계값 (기본값: 0.5)',
            default: 0.5
          },
          project_id: {
            type: 'string',
            description: '지정 시 해당 프로젝트 기억만 주입. 미지정 시 전체 기억에서 검색',
            maxLength: 200
          },
          owner_id: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: '소유자(owner) 범위로 결과를 제한합니다.'
          }
        },
        required: ['query']
      }
    );
  }

  async handle(params: unknown, context: ToolContext): Promise<ToolResult> {
    const {
      query,
      token_budget = 1000,
      max_memories = 5,
      memory_types = ['working', 'episodic', 'semantic', 'procedural'],
      importance_threshold: _importance_threshold = 0.5,
      project_id,
      owner_id
    } = MemoryInjectionSchema.parse(params);

    try {
      logger.info('Memory Injection 시작', {
        query,
        token_budget
      });

      if (!context.db) {
        throw new Error('데이터베이스가 연결되지 않았습니다');
      }

      if (!context.services?.hybridSearchEngine) {
        throw new Error('하이브리드 검색 엔진이 사용할 수 없습니다');
      }

      const invalidTypes = memory_types.filter((t) => t === 'core' || t === 'vault');
      if (invalidTypes.length > 0) {
        this.logWarning(
          'memory_types 배열에서 core/vault는 memory_item 검색에 사용할 수 없습니다. 자동으로 제거합니다.',
          {
            invalid_types: invalidTypes,
            original_memory_types: memory_types,
            suggestion: 'Core/Vault 조회는 recall Tool의 type 파라미터를 사용하세요.',
          },
        );
      }

      const memoryTypesForBundle = normalizeMemoryTypesForHybridItemSearch(memory_types);

      const bundle = await buildKnowledgeContextBundle(
        {
          db: context.db,
          hybridSearchEngine: context.services.hybridSearchEngine,
          consolidationScoreService: context.services.consolidationScoreService,
          writeCoalescingManager: context.services.writeCoalescingManager,
        },
        {
          query,
          tokenBudget: token_budget,
          maxMemories: max_memories,
          memoryTypes: memoryTypesForBundle,
          projectId: project_id,
          ownerId: owner_id,
        },
      );

      logger.info('Memory Injection 완료', {
        memoryCount: bundle.itemCount,
        tokenCount: bundle.tokenEstimate,
      });

      if (
        mementoConfig.autoSetAnchorDefault
        && bundle.topMemoryId
        && context.services?.anchorManager
      ) {
        const anchorHost: RecallToolHost = {
          logInfo: (message, additionalData) => this.logInfo(message, additionalData),
          logWarning: (message, additionalData) => this.logWarning(message, additionalData),
          logError: (error, contextLabel, additionalData) =>
            this.logError(error, contextLabel, additionalData),
          validateService: <T>(service: T | undefined, serviceName: string): asserts service is T => {
            this.validateService(service, serviceName);
          },
          createSuccessResult: (data) => this.createSuccessResult(data),
        };
        await handleAutoSetAnchor(
          anchorHost,
          [{
            id: bundle.topMemoryId,
            memory_id: bundle.topMemoryId,
            content: '',
            type: 'episodic',
            importance: 0,
            created_at: new Date().toISOString(),
          }],
          'default',
          context
        );
      }

      return this.createSuccessResult({
        message: bundle.promptText,
        memories_used: bundle.itemCount,
        token_estimate: bundle.tokenEstimate,
        query: bundle.query,
      });

    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('Memory Injection 실패', {
        error: maskedError.message
      });
      throw error;
    }
  }
}
