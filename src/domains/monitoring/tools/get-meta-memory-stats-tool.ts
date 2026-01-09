/**
 * Get Meta Memory Stats Tool - 메타 메모리 통계 조회 도구
 * 
 * 메타 메모리 통계를 조회하는 MCP 도구입니다.
 * recall 성공/실패, confidence 점수 등의 통계를 조회할 수 있습니다.
 * 
 * @example
 * ```typescript
 * // 특정 메모리 통계 조회
 * const result = await tool.handle({ memory_id: 'mem_12345' }, context);
 * 
 * // 여러 메모리 통계 조회
 * const result = await tool.handle({ 
 *   memory_ids: ['mem_1', 'mem_2', 'mem_3'] 
 * }, context);
 * 
 * // 필터링 조회
 * const result = await tool.handle({
 *   min_recall_count: 10,
 *   min_confidence: 0.5,
 *   limit: 50
 * }, context);
 * ```
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import type { GetMetaMemoryStatsParams, MetaMemoryStatsResult } from '../../../shared/types/index.js';
import type { MetaMemoryService } from '../../../services/meta-memory-service.js';

/**
 * Get Meta Memory Stats 파라미터 스키마
 * 
 * 모든 필드는 선택적이며, 다양한 필터링 옵션을 제공합니다.
 * memory_id와 memory_ids는 동시에 사용할 수 없습니다.
 */
const GetMetaMemoryStatsSchema = z.object({
  memory_id: z.string().optional().describe('단일 메모리 ID (memory_ids와 동시 사용 불가)'),
  memory_ids: z.array(z.string()).optional().describe('메모리 ID 배열 (memory_id와 동시 사용 불가)'),
  min_recall_count: z.number().min(0).optional().describe('최소 recall_count (0 이상)'),
  min_confidence: z.number().min(0).max(1).optional().describe('최소 avg_confidence (0 이상 1 이하)'),
  limit: z.number().min(1).max(1000).default(100).optional().describe('결과 제한 수 (1 이상 1000 이하, 기본값: 100)')
}).refine(
  (data) => !(data.memory_id && data.memory_ids),
  {
    message: 'memory_id와 memory_ids는 동시에 사용할 수 없습니다',
    path: ['memory_id']
  }
);

/**
 * Get Meta Memory Stats Tool
 * 
 * 메타 메모리 통계를 조회하는 도구입니다.
 * recall 성공/실패, confidence 점수 등의 통계를 조회할 수 있습니다.
 * 
 * @see MetaMemoryService.getStats() - 실제 통계 조회 로직
 */
export class GetMetaMemoryStatsTool extends BaseTool {
  constructor() {
    super(
      'get_meta_memory_stats',
      '메타 메모리 통계를 조회합니다. recall 성공/실패, confidence 점수 등의 통계를 조회할 수 있습니다.',
      {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: '단일 메모리 ID (memory_ids와 동시 사용 불가)'
          },
          memory_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '메모리 ID 배열 (memory_id와 동시 사용 불가)'
          },
          min_recall_count: {
            type: 'number',
            minimum: 0,
            description: '최소 recall_count (0 이상)'
          },
          min_confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '최소 avg_confidence (0 이상 1 이하)'
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 1000,
            default: 100,
            description: '결과 제한 수 (1 이상 1000 이하, 기본값: 100)'
          }
        },
        required: []
      }
    );
  }

  /**
   * 도구 실행 핸들러
   * 
   * 메타 메모리 통계를 조회합니다.
   * 
   * @param params - 조회 파라미터 (GetMetaMemoryStatsParams)
   * @param context - 도구 실행 컨텍스트
   * @returns 통계 조회 결과
   * 
   * @throws {Error} 데이터베이스 연결이 없을 때
   * @throws {Error} MetaMemoryService가 없을 때
   * @throws {Error} 파라미터 검증 실패 시
   * @throws {Error} 통계 조회 실패 시
   */
  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    // 데이터베이스 연결 확인
    this.validateDatabase(context);

    // MetaMemoryService 확인
    this.validateService(context.services.metaMemoryService, '메타 메모리 통계 서비스');

    try {
      // 파라미터 검증 및 기본값 적용
      const validatedParams = GetMetaMemoryStatsSchema.parse(params);
      
      // limit 기본값 적용 (Zod default가 제대로 적용되지 않을 수 있으므로 명시적으로 처리)
      const paramsWithDefaults: GetMetaMemoryStatsParams = {
        ...validatedParams,
        limit: validatedParams.limit ?? 100
      };

      // MetaMemoryService.getStats 호출
      const metaMemoryService = context.services.metaMemoryService as MetaMemoryService;
      const result: MetaMemoryStatsResult = await metaMemoryService.getStats(paramsWithDefaults);

      // 결과를 ISO 8601 형식으로 변환하여 반환
      return this.createSuccessResult({
        items: result.items.map(item => ({
          memory_id: item.memory_id,
          recall_count: item.recall_count,
          success_count: item.success_count,
          failure_count: item.failure_count,
          avg_confidence: item.avg_confidence,
          last_recalled_at: item.last_recalled_at?.toISOString(),
          created_at: item.created_at.toISOString(),
          updated_at: item.updated_at.toISOString()
        })),
        total_count: result.total_count,
        message: '메타 메모리 통계 조회 완료'
      });
    } catch (error) {
      // Zod 에러는 사용자 친화적인 메시지로 변환
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => {
          const path = e.path.length > 0 ? e.path.join('.') : 'root';
          return `${path}: ${e.message}`;
        }).join(', ');
        throw new Error(`파라미터 검증 실패: ${errorMessages}`);
      }
      
      // 기타 에러는 원본 메시지 포함
      throw new Error(`메타 메모리 통계 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
