/**
 * Recall Tool - 기억 검색 도구
 * 하이브리드 검색을 통한 고성능 기억 검색
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import { CommonSchemas } from './types.js';

const RecallSchema = z.object({
  query: CommonSchemas.Query,
  filters: z.object({
    type: z.array(CommonSchemas.MemoryType).optional(),
    tags: z.array(z.string()).optional(),
    privacy_scope: z.array(CommonSchemas.PrivacyScope).optional(),
    time_from: z.string().optional(),
    time_to: z.string().optional(),
    pinned: z.boolean().optional(),
    importance_min: z.number().min(0).max(1).optional(),
    importance_max: z.number().min(0).max(1).optional()
  }).optional(),
  limit: CommonSchemas.Limit,
  search_options: z.object({
    vector_weight: z.number().min(0).max(1).optional(),
    text_weight: z.number().min(0).max(1).optional(),
    enable_hybrid: z.boolean().optional(),
    include_metadata: z.boolean().optional()
  }).optional()
});

export class RecallTool extends BaseTool {
  constructor() {
    super(
      'recall',
      '관련 기억을 검색합니다',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: '검색 쿼리' },
          filters: {
            type: 'object',
            properties: {
              type: { 
                type: 'array', 
                items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural'] },
                description: '기억 타입 필터'
              },
              tags: { 
                type: 'array', 
                items: { type: 'string' },
                description: '태그 필터'
              },
              privacy_scope: { 
                type: 'array', 
                items: { type: 'string', enum: ['private', 'team', 'public'] },
                description: '프라이버시 범위 필터'
              },
              time_from: { 
                type: 'string', 
                format: 'date-time',
                description: '시작 시간'
              },
              time_to: { 
                type: 'string', 
                format: 'date-time',
                description: '종료 시간'
              },
              pinned: { 
                type: 'boolean',
                description: '핀된 기억만 검색'
              },
              importance_min: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: '최소 중요도'
              },
              importance_max: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: '최대 중요도'
              }
            }
          },
          limit: { 
            type: 'number', 
            minimum: 1, 
            maximum: 100, 
            default: 10,
            description: '최대 결과 수'
          },
          search_options: {
            type: 'object',
            properties: {
              vector_weight: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0.6,
                description: '벡터 검색 가중치'
              },
              text_weight: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                default: 0.4,
                description: '텍스트 검색 가중치'
              },
              enable_hybrid: {
                type: 'boolean',
                default: true,
                description: '하이브리드 검색 사용 여부'
              },
              include_metadata: {
                type: 'boolean',
                default: true,
                description: '메타데이터 포함 여부'
              }
            }
          }
        },
        required: ['query']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    this.logInfo('Recall 도구 호출됨', { params });
    
    try {
      // 파라미터 검증 및 파싱
      const { query, filters, limit, search_options } = RecallSchema.parse(params);
      this.logInfo('파라미터 파싱 완료', { query, filters, limit, search_options });
      
      // 입력 검증
      this.validateString(query, '검색 쿼리', 1000);
      this.validateNumber(limit, '결과 제한', 1, 100);
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      // 하이브리드 검색 엔진 확인
      this.validateService(context.services.hybridSearchEngine, '하이브리드 검색 엔진');
      
      const startTime = Date.now();
      
      // 검색 옵션 설정
      const vectorWeight = search_options?.vector_weight ?? 0.6;
      const textWeight = search_options?.text_weight ?? 0.4;
      const enableHybrid = search_options?.enable_hybrid ?? true;
      const includeMetadata = search_options?.include_metadata ?? true;
      
      // 가중치 정규화
      const totalWeight = vectorWeight + textWeight;
      const normalizedVectorWeight = totalWeight > 0 ? vectorWeight / totalWeight : 0.6;
      const normalizedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.4;
      
      let searchResult;
      
      try {
        if (enableHybrid && context.services.hybridSearchEngine.isEmbeddingAvailable()) {
          // 하이브리드 검색 (텍스트 + 벡터)
          this.logInfo('하이브리드 검색 실행', { 
            query, 
            vectorWeight: normalizedVectorWeight, 
            textWeight: normalizedTextWeight 
          });
          
          searchResult = await context.services.hybridSearchEngine.search(context.db, {
            query,
            filters,
            limit,
            vectorWeight: normalizedVectorWeight,
            textWeight: normalizedTextWeight
          });
        } else {
          // 텍스트 검색만 사용
          if (!context.services.searchEngine) {
            throw new Error('텍스트 검색 엔진을 사용할 수 없습니다');
          }
          
          this.logInfo('텍스트 검색 실행', { query });
          
          searchResult = await context.services.searchEngine.search(context.db, {
            query,
            filters,
            limit
          });
        }
      } catch (searchError) {
        this.logError(searchError as Error, '검색 실행 중 오류', { query, enableHybrid });
        throw new Error(`검색 실행 실패: ${(searchError as Error).message}`);
      }
      
      const executionTime = Date.now() - startTime;
      
      // 결과 후처리
      const processedResults = this.processSearchResults(searchResult.items, includeMetadata);
      
      this.logInfo('검색 완료', { 
        resultCount: processedResults.length, 
        executionTime,
        searchType: enableHybrid ? 'hybrid' : 'text'
      });
      
      return this.createSuccessResult({
        items: processedResults,
        total_count: searchResult.total_count || processedResults.length,
        query_time: executionTime,
        search_type: enableHybrid ? 'hybrid' : 'text',
        vector_search_available: context.services.hybridSearchEngine.isEmbeddingAvailable(),
        filters_applied: this.getAppliedFilters(filters),
        search_options: {
          vector_weight: normalizedVectorWeight,
          text_weight: normalizedTextWeight,
          enable_hybrid: enableHybrid
        }
      });
      
    } catch (error) {
      this.logError(error as Error, 'Recall 도구 실행 실패', { params });
      
      // 사용자 친화적인 에러 메시지 반환
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          throw new Error(`입력 검증 실패: ${error.message}`);
        } else if (error.message.includes('database')) {
          throw new Error(`데이터베이스 오류: ${error.message}`);
        } else if (error.message.includes('search')) {
          throw new Error(`검색 오류: ${error.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * 검색 결과 후처리
   */
  private processSearchResults(items: any[], includeMetadata: boolean): any[] {
    return items.map(item => {
      const processed: any = {
        id: item.id,
        content: item.content,
        type: item.type,
        importance: item.importance,
        created_at: item.created_at,
        final_score: item.finalScore || item.score || 0
      };

      if (includeMetadata) {
        processed.last_accessed = item.last_accessed;
        processed.pinned = item.pinned;
        processed.tags = item.tags;
        processed.source = item.source;
        processed.privacy_scope = item.privacy_scope;
        
        if (item.textScore !== undefined) {
          processed.text_score = item.textScore;
        }
        if (item.vectorScore !== undefined) {
          processed.vector_score = item.vectorScore;
        }
        if (item.recall_reason) {
          processed.recall_reason = item.recall_reason;
        }
      }

      return processed;
    });
  }

  /**
   * 적용된 필터 정보 반환
   */
  private getAppliedFilters(filters?: any): any {
    if (!filters) return {};
    
    const applied: any = {};
    
    if (filters.type && filters.type.length > 0) {
      applied.type = filters.type;
    }
    if (filters.tags && filters.tags.length > 0) {
      applied.tags = filters.tags;
    }
    if (filters.privacy_scope && filters.privacy_scope.length > 0) {
      applied.privacy_scope = filters.privacy_scope;
    }
    if (filters.time_from) {
      applied.time_from = filters.time_from;
    }
    if (filters.time_to) {
      applied.time_to = filters.time_to;
    }
    if (filters.pinned !== undefined) {
      applied.pinned = filters.pinned;
    }
    if (filters.importance_min !== undefined) {
      applied.importance_min = filters.importance_min;
    }
    if (filters.importance_max !== undefined) {
      applied.importance_max = filters.importance_max;
    }
    
    return applied;
  }

  /**
   * 검색 쿼리 검증
   */
  private validateQuery(query: string): void {
    if (!query || query.trim().length === 0) {
      throw new Error('검색 쿼리는 비어있을 수 없습니다');
    }
    
    if (query.length > 1000) {
      throw new Error('검색 쿼리가 너무 깁니다 (최대 1000자)');
    }
    
    // 특수 문자 검증
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        throw new Error('검색 쿼리에 허용되지 않는 문자가 포함되어 있습니다');
      }
    }
  }

  /**
   * 필터 검증
   */
  private validateFilters(filters?: any): void {
    if (!filters) return;
    
    // 시간 범위 검증
    if (filters.time_from && filters.time_to) {
      const fromDate = new Date(filters.time_from);
      const toDate = new Date(filters.time_to);
      
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error('유효하지 않은 시간 형식입니다');
      }
      
      if (fromDate > toDate) {
        throw new Error('시작 시간은 종료 시간보다 이전이어야 합니다');
      }
    }
    
    // 중요도 범위 검증
    if (filters.importance_min !== undefined && filters.importance_max !== undefined) {
      if (filters.importance_min > filters.importance_max) {
        throw new Error('최소 중요도는 최대 중요도보다 작거나 같아야 합니다');
      }
    }
  }
}