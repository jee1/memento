/**
 * Search Local Tool - 국소 검색 도구
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';

const SearchLocalSchema = z.object({
  slot: z.enum(['A', 'B', 'C'], {
    errorMap: () => ({ message: 'Slot must be A, B, or C' })
  }),
  query: z.string().optional(),
  hop_limit: z.number().min(1).max(5).optional(),
  limit: z.number().min(1).max(100).default(10),
  min_results: z.number().min(0).max(100).default(3),
  agent_id: z.string().optional().default('default'),
  use_relations: z.boolean().optional().default(true)
});

export class SearchLocalTool extends BaseTool {
  constructor() {
    super(
      'search_local',
      '앵커 주변에서 국소 검색을 수행합니다',
      {
        type: 'object',
        properties: {
          slot: {
            type: 'string',
            enum: ['A', 'B', 'C'],
            description: '검색할 앵커 슬롯'
          },
          query: {
            type: 'string',
            description: '검색 쿼리 (선택적, 제공하지 않으면 앵커 주변 모든 메모리 반환)'
          },
          hop_limit: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            description: '최대 hop 거리 (기본값: 슬롯별 설정)'
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 100,
            default: 10,
            description: '최대 결과 수'
          },
          min_results: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            default: 3,
            description: '최소 결과 수 (이보다 적으면 fallback)'
          },
          agent_id: {
            type: 'string',
            description: '에이전트 ID (기본값: "default")',
            default: 'default'
          },
          use_relations: {
            type: 'boolean',
            description: '관계 그래프 사용 여부 (기본값: true)',
            default: true
          }
        },
        required: ['slot']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      // 파라미터 검증
      const { slot, query, hop_limit, limit, min_results, agent_id, use_relations } = SearchLocalSchema.parse(params);
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      // AnchorManager 서비스 확인
      this.validateService(context.services.anchorManager, '앵커 관리자');
      
      // 국소 검색 수행
      try {
        const searchResult = await context.services.anchorManager!.searchLocal(
          agent_id,
          slot,
          query || undefined,
          hop_limit,
          {
            limit,
            min_results,
            use_relations
          }
        );
        
        return this.createSuccessResult({
          items: searchResult.items,
          total_count: searchResult.total_count,
          local_results_count: searchResult.local_results_count,
          fallback_used: searchResult.fallback_used,
          query_time: searchResult.query_time,
          anchor_info: searchResult.anchor_info
        });
      } catch (searchError: any) {
        // 앵커가 없고 query가 있으면 fallback
        if (query && searchError?.message?.includes('Anchor not found')) {
          if (!context.services.hybridSearchEngine) {
            throw new Error('HybridSearchEngine is not available for fallback');
          }
          
          try {
            const fallbackResult = await context.services.hybridSearchEngine.search(context.db!, {
              query,
              limit
            });
            
            return this.createSuccessResult({
              items: fallbackResult.items,
              total_count: fallbackResult.total_count,
              local_results_count: 0,
              fallback_used: true,
              query_time: fallbackResult.query_time || 0,
              anchor_info: null
            });
          } catch (fallbackError: any) {
            // Fallback도 실패하면 빈 결과 반환
            return this.createSuccessResult({
              items: [],
              total_count: 0,
              local_results_count: 0,
              fallback_used: true,
              query_time: 0,
              anchor_info: null
            });
          }
        }
        
        // 다른 에러는 그대로 throw
        throw searchError;
      }
    } catch (error) {
      this.logError(error as Error, '국소 검색 실패', { params });
      
      if (error instanceof z.ZodError) {
        throw new Error(`입력 검증 실패: ${error.errors.map(e => e.message).join(', ')}`);
      }
      
      throw error;
    }
  }
}

