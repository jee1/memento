/**
 * Get Memory Neighbors Tool - 이웃 기억 조회 도구
 * 벡터 유사도를 기반으로 특정 기억의 이웃 기억을 조회
 */

import { z } from 'zod';
import { BaseTool } from '../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../tools/types.js';
import { CommonSchemas } from '../../tools/types.js';
import { MemoryNeighborService } from '../../services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../../algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../../services/memory-embedding-service.js';
import { MemoryNotFoundError } from '../../services/memory-neighbor-service.js';

const GetMemoryNeighborsSchema = z.object({
  memory_id: CommonSchemas.MemoryId,
  limit: z.number().min(1).max(50).optional().default(5),
  similarity_threshold: z.number().min(0).max(1).optional().default(0.8),
});

export { GetMemoryNeighborsSchema };

export class GetMemoryNeighborsTool extends BaseTool {
  constructor() {
    super(
      'get_memory_neighbors',
      '특정 기억과 유사한 이웃 기억을 조회합니다',
      {
        type: 'object',
        properties: {
          memory_id: {
            type: 'string',
            description: '조회할 기억의 ID'
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            description: '반환할 이웃 기억의 최대 개수',
            default: 5
          },
          similarity_threshold: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '유사도 임계값 (0.0 ~ 1.0)',
            default: 0.8
          }
        },
        required: ['memory_id']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    this.logInfo('Get Memory Neighbors 도구 호출됨', { params });
    
    try {
      // 파라미터 검증 및 파싱
      const { memory_id, limit, similarity_threshold } = GetMemoryNeighborsSchema.parse(params);
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);

      // MemoryNeighborService 인스턴스 생성
      let vectorSearchEngine;
      try {
        vectorSearchEngine = getVectorSearchEngine();
      } catch (error) {
        this.logError(error as Error, 'VectorSearchEngine 초기화 실패');
        throw new Error(`벡터 검색 엔진 초기화 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      const embeddingService = context.services.embeddingService || new MemoryEmbeddingService();
      
      let neighborService;
      try {
        neighborService = new MemoryNeighborService(
          vectorSearchEngine,
          embeddingService
        );
      } catch (error) {
        this.logError(error as Error, 'MemoryNeighborService 생성 실패');
        throw new Error(`이웃 기억 서비스 생성 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      // 데이터베이스 설정
      try {
        neighborService.setDatabase(context.db!);
      } catch (error) {
        this.logError(error as Error, '데이터베이스 설정 실패');
        throw new Error(`데이터베이스 설정 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      // 이웃 기억 조회
      const result = await neighborService.getNeighbors(memory_id, {
        limit,
        similarity_threshold
      });
      
      this.logInfo('이웃 기억 조회 성공', {
        memory_id: result.memory_id,
        total_count: result.total_count,
        query_time: result.query_time
      });
      
      return this.createSuccessResult({
        memory_id: result.memory_id,
        neighbors: result.neighbors,
        total_count: result.total_count,
        query_time: result.query_time
      });
    } catch (error) {
      this.logError(error as Error, 'Get Memory Neighbors 도구 실행 실패', { params });
      
      // MemoryNotFoundError는 그대로 전파 (명확한 에러 메시지)
      if (error instanceof MemoryNotFoundError) {
        throw new Error(`메모리를 찾을 수 없습니다: ${error.message}`);
      }
      
      // Zod 스키마 검증 에러 처리
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        throw new Error(`입력 검증 실패: ${errorMessages}`);
      }
      
      // 사용자 친화적인 에러 메시지 반환
      if (error instanceof Error) {
        if (error.message.includes('validation') || error.message.includes('검증')) {
          throw new Error(`입력 검증 실패: ${error.message}`);
        } else if (error.message.includes('database') || error.message.includes('데이터베이스')) {
          throw new Error(`데이터베이스 오류: ${error.message}`);
        } else if (error.message.includes('search') || error.message.includes('검색')) {
          throw new Error(`검색 오류: ${error.message}`);
        } else if (error.message.includes('not found') || error.message.includes('찾을 수 없습니다')) {
          throw error; // 이미 처리된 에러는 그대로 전파
        }
      }
      
      throw new Error(`이웃 기억 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

