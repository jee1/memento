/**
 * Memory Neighbor Service
 * 벡터 유사도를 기반으로 특정 기억의 이웃 기억을 조회하는 서비스
 */

import type { VectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import type { MemoryEmbeddingService } from './memory-embedding-service.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';

/**
 * 이웃 기억 조회 결과
 */
export interface NeighborMemory {
  id: string;
  content: string;
  type: string;
  similarity: number;
  importance?: number;
  created_at?: string;
  tags?: string[];
}

/**
 * 이웃 기억 조회 응답
 */
export interface NeighborSearchResult {
  memory_id: string;
  neighbors: NeighborMemory[];
  total_count: number;
  query_time: number;
}

/**
 * 이웃 기억 조회 옵션
 */
export interface NeighborSearchOptions {
  limit?: number;
  similarity_threshold?: number;
}

/**
 * 메모리를 찾을 수 없을 때 발생하는 에러
 */
export class MemoryNotFoundError extends Error {
  constructor(memoryId: string) {
    super(`Memory with ID '${memoryId}' not found`);
    this.name = 'MemoryNotFoundError';
  }
}

/**
 * Memory Neighbor Service
 * 벡터 유사도를 기반으로 기억의 이웃을 찾는 서비스
 */
export class MemoryNeighborService {
  private readonly vectorSearchEngine: VectorSearchEngine;
  private readonly embeddingService: MemoryEmbeddingService;
  private db: Database.Database | null = null;

  /**
   * 생성자
   * @param vectorSearchEngine - 벡터 검색 엔진 인스턴스
   * @param embeddingService - 메모리 임베딩 서비스 인스턴스
   */
  constructor(
    vectorSearchEngine: VectorSearchEngine,
    embeddingService: MemoryEmbeddingService
  ) {
    if (!vectorSearchEngine) {
      throw new Error('VectorSearchEngine is required');
    }
    if (!embeddingService) {
      throw new Error('MemoryEmbeddingService is required');
    }
    
    this.vectorSearchEngine = vectorSearchEngine;
    this.embeddingService = embeddingService;
  }

  /**
   * 데이터베이스 설정
   * VectorSearchEngine에도 데이터베이스를 설정합니다.
   * @param db - 데이터베이스 인스턴스
   */
  setDatabase(db: Database.Database): void {
    if (!db) {
      throw new Error('Database instance is required');
    }
    this.db = db;
    // VectorSearchEngine에도 데이터베이스 설정 (메서드가 있는 경우)
    if (this.vectorSearchEngine && typeof (this.vectorSearchEngine as any).setDatabase === 'function') {
      (this.vectorSearchEngine as any).setDatabase(db);
    }
  }

  /**
   * 특정 기억의 이웃 기억을 조회
   * @param memoryId - 조회할 기억의 ID
   * @param options - 조회 옵션 (limit, similarity_threshold)
   * @returns 이웃 기억 조회 결과
   * @throws {MemoryNotFoundError} 메모리를 찾을 수 없는 경우
   * @throws {Error} 데이터베이스 오류, 벡터 검색 오류 등
   */
  async getNeighbors(
    memoryId: string,
    options: NeighborSearchOptions = {}
  ): Promise<NeighborSearchResult> {
    const startTime = Date.now();
    
    try {
      // 기본값 설정
      const limit = options.limit ?? 5;
      const similarityThreshold = options.similarity_threshold ?? 0.8;

      // 데이터베이스 확인
      if (!this.db) {
        throw new Error('Database is not set. Call setDatabase() first.');
      }

      // 1.4 - 메모리 ID 검증 로직
      let memory;
      try {
        memory = await DatabaseUtils.get(
          this.db,
          'SELECT id FROM memory_item WHERE id = ?',
          [memoryId]
        );
      } catch (error) {
        console.error(`❌ 메모리 조회 실패 (${memoryId}):`, error);
        throw new Error(`Failed to query memory: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      if (!memory) {
        throw new MemoryNotFoundError(memoryId);
      }
      
      // 1.5 - 임베딩 조회 로직
      // memory_embedding 테이블에서 해당 기억의 임베딩 조회
      // 가장 최근에 생성된 임베딩을 우선 사용 (여러 제공자가 있을 수 있음)
      let embeddingRecord;
      try {
        embeddingRecord = await DatabaseUtils.get(
          this.db,
          `SELECT 
            embedding,
            embedding_provider,
            dimensions,
            dim
          FROM memory_embedding
          WHERE memory_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
          [memoryId]
        );
      } catch (error) {
        console.error(`❌ 임베딩 조회 실패 (${memoryId}):`, error);
        throw new Error(`Failed to query embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      // 1.6 - 임베딩이 없는 경우 처리
      if (!embeddingRecord || !embeddingRecord.embedding) {
        // 임베딩이 없으면 빈 결과 반환 (경고 없이)
        const queryTime = Date.now() - startTime;
        return {
          memory_id: memoryId,
          neighbors: [],
          total_count: 0,
          query_time: queryTime
        };
      }
      
      // JSON 문자열로 저장된 임베딩을 배열로 파싱
      let queryVector: number[];
      try {
        queryVector = typeof embeddingRecord.embedding === 'string'
          ? JSON.parse(embeddingRecord.embedding)
          : embeddingRecord.embedding;
        
        if (!Array.isArray(queryVector) || queryVector.length === 0) {
          // 유효하지 않은 임베딩이면 빈 결과 반환
          const queryTime = Date.now() - startTime;
          return {
            memory_id: memoryId,
            neighbors: [],
            total_count: 0,
            query_time: queryTime
          };
        }
      } catch (error) {
        // 파싱 실패 시 빈 결과 반환 (경고 없이)
        const queryTime = Date.now() - startTime;
        return {
          memory_id: memoryId,
          neighbors: [],
          total_count: 0,
          query_time: queryTime
        };
      }
      
      const embeddingProvider = embeddingRecord.embedding_provider || 'tfidf';
      
      // 1.7 - VectorSearchEngine.search 메서드를 활용하여 유사 기억 검색
      // VectorSearchEngine에 데이터베이스가 설정되어 있는지 확인
      // (initialize 메서드가 있는 경우 호출)
      try {
        if (typeof (this.vectorSearchEngine as any).initialize === 'function') {
          (this.vectorSearchEngine as any).initialize(this.db);
        }
      } catch (error) {
        console.error(`❌ VectorSearchEngine 초기화 실패:`, error);
        throw new Error(`Failed to initialize VectorSearchEngine: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      // 벡터 검색 실행
      // limit을 더 많이 가져와서 필터링 후 최종 limit 적용
      const searchLimit = limit + 1; // 자기 자신 제외를 위해 +1
      let searchResults;
      try {
        searchResults = await this.vectorSearchEngine.search(
          queryVector,
          {
            limit: searchLimit,
            threshold: 0.0, // 임계값은 나중에 필터링에서 적용
            includeContent: true,
            includeMetadata: true
          },
          embeddingProvider
        );
      } catch (error) {
        console.error(`❌ 벡터 검색 실패 (${memoryId}):`, error);
        throw new Error(`Failed to search similar memories: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      
      // 1.8 - 결과 필터링: 동일한 memory_id 제외, 유사도 임계값(threshold) 이상만 반환
      const filteredResults = searchResults
        .filter(result => {
          // 동일한 기억 제외
          if (result.memory_id === memoryId) {
            return false;
          }
          // 유사도 임계값 이상만 반환
          return result.similarity >= similarityThreshold;
        })
        .slice(0, limit); // 최종 limit 적용
      
      // 1.9 - 응답 형식 구성: 이웃 기억 목록, 총 개수, 쿼리 실행 시간 포함
      const neighbors: NeighborMemory[] = filteredResults.map(result => ({
        id: result.memory_id,
        content: result.content,
        type: result.type,
        similarity: result.similarity,
        importance: result.importance,
        created_at: result.created_at,
        tags: result.tags
      }));
      
      const queryTime = Date.now() - startTime;
      
      return {
        memory_id: memoryId,
        neighbors,
        total_count: neighbors.length,
        query_time: queryTime
      };
    } catch (error) {
      // 1.10 - 에러 처리: 예외 상황에 대한 적절한 에러 메시지 및 로깅
      const queryTime = Date.now() - startTime;
      
      // MemoryNotFoundError는 그대로 전파
      if (error instanceof MemoryNotFoundError) {
        throw error;
      }
      
      // 기타 에러는 로깅 후 재던지기
      // PRD 0019: 보안 강화 (Phase 1) - PII 마스킹 강화
      // 오류 메시지와 stack trace에 PII 마스킹 적용
      const errorMessage = error instanceof Error ? error.message : String(error);
      const maskedMessage = PIIMasker.mask(errorMessage).masked;
      const maskedStack = error instanceof Error && error.stack 
        ? PIIMasker.mask(error.stack).masked 
        : 'N/A';
      console.error(`❌ 이웃 기억 조회 실패 (${memoryId}):`, maskedMessage);
      console.error(`   쿼리 시간: ${queryTime}ms`);
      console.error(`   에러 스택:`, maskedStack);
      
      // 사용자 친화적인 에러 메시지로 변환
      if (error instanceof Error) {
        throw new Error(`Failed to get memory neighbors: ${error.message}`);
      }
      
      throw new Error(`Failed to get memory neighbors: Unknown error`);
    }
  }

  /**
   * 새로 저장된 기억에 대한 인접 기억 목록 갱신
   * PRD 3.1-3.3 요구사항: 새 기억 저장 시 기존 기억들과의 유사도 계산 및 인접 기억 식별
   * 
   * @param newMemoryId - 새로 저장된 기억의 ID
   * @param similarityThreshold - 유사도 임계값 (기본값: 0.8)
   * @returns 인접 기억 ID 목록 (유사도가 임계값 이상인 기억들)
   */
  async updateNeighborsForNewMemory(
    newMemoryId: string,
    similarityThreshold: number = 0.8
  ): Promise<string[]> {
    if (!this.db) {
      console.warn('⚠️ 데이터베이스가 설정되지 않아 인접 기억 갱신을 건너뜁니다.');
      return [];
    }

    try {
      // 새 기억의 임베딩 조회
      const embeddingRecord = await DatabaseUtils.get(
        this.db,
        `SELECT 
          embedding,
          embedding_provider,
          dimensions,
          dim
        FROM memory_embedding
        WHERE memory_id = ?
        ORDER BY created_at DESC
        LIMIT 1`,
        [newMemoryId]
      );

      // 임베딩이 없으면 빈 배열 반환 (경고 없이)
      if (!embeddingRecord || !embeddingRecord.embedding) {
        return [];
      }

      // JSON 문자열로 저장된 임베딩을 배열로 파싱
      let queryVector: number[];
      try {
        queryVector = typeof embeddingRecord.embedding === 'string'
          ? JSON.parse(embeddingRecord.embedding)
          : embeddingRecord.embedding;
        
        if (!Array.isArray(queryVector) || queryVector.length === 0) {
          return [];
        }
      } catch (error) {
        // 파싱 실패 시 빈 배열 반환
        return [];
      }

      const embeddingProvider = embeddingRecord.embedding_provider || 'tfidf';

      // VectorSearchEngine 초기화
      if (typeof (this.vectorSearchEngine as any).initialize === 'function') {
        (this.vectorSearchEngine as any).initialize(this.db);
      }

      // 기존 모든 기억과의 유사도 계산
      // sqlite-vec의 최대 제한(4096)을 고려하여 limit 설정
      // 실제로는 모든 기억을 검색하려는 의도이지만, 벡터 검색 엔진의 제한을 준수
      const maxLimit = 4096; // sqlite-vec의 최대 k 값 제한
      const searchResults = await this.vectorSearchEngine.search(
        queryVector,
        {
          limit: maxLimit, // sqlite-vec 최대 제한
          threshold: 0.0, // 임계값은 나중에 필터링에서 적용
          includeContent: false, // 성능 최적화: 내용 불필요
          includeMetadata: false
        },
        embeddingProvider
      );

      // 유사도가 임계값 이상인 기억들을 식별 (자기 자신 제외)
      const neighborIds = searchResults
        .filter(result => {
          // 동일한 기억 제외
          if (result.memory_id === newMemoryId) {
            return false;
          }
          // 유사도 임계값 이상만 반환
          return result.similarity >= similarityThreshold;
        })
        .map(result => result.memory_id);

      // PRD 3.4: 인접 기억 정보를 데이터베이스에 저장 (선택적)
      // 이번 단계에서는 저장하지 않고 계산만 수행
      // 향후 성능 최적화가 필요한 경우 memory_neighbors 테이블 추가 고려

      return neighborIds;
    } catch (error) {
      // 에러 발생 시 로깅 후 빈 배열 반환 (메모리 저장은 성공했으므로)
      console.error(`❌ 인접 기억 갱신 실패 (${newMemoryId}):`, error);
      return [];
    }
  }
}

