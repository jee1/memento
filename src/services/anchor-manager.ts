/**
 * Anchor Manager Service
 * 앵커 상태 관리 및 국소 검색 기능 제공
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: 앵커 상태 관리 및 국소 검색만 담당
 * - 의존성 역전: Database와 다른 서비스에 의존
 * - 캐시 최적화: 메모리 캐시를 통한 빠른 읽기 접근
 */

import type Database from 'better-sqlite3';
import type { MemoryEmbeddingService } from './memory-embedding-service.js';
import type { HybridSearchEngine } from '../algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import type { VectorSearchEngine } from '../algorithms/vector-search-engine.js';
import { UnifiedEmbeddingService } from './unified-embedding-service.js';

/**
 * 앵커 슬롯 타입
 */
export type AnchorSlot = 'A' | 'B' | 'C';

/**
 * 앵커 정보
 */
export interface AnchorInfo {
  agent_id: string;
  slot: AnchorSlot;
  memory_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 국소 검색 옵션
 */
export interface SearchOptions {
  limit?: number;
  min_results?: number;
  vector_weight?: number;
  text_weight?: number;
  autoMoveEnabled?: boolean; // 자동 앵커 이동 활성화 여부 (기본값: false)
}

/**
 * 국소 검색 결과
 */
export interface SearchResult {
  items: Array<{
    id: string;
    content: string;
    type: string;
    similarity?: number;
    hop_distance?: number;
    [key: string]: any;
  }>;
  total_count: number;
  local_results_count: number;
  fallback_used: boolean;
  query_time: number;
  anchor_info?: {
    agent_id: string;
    slot: AnchorSlot;
    memory_id: string | null;
  };
}

/**
 * 앵커 설정 에러
 */
export class AnchorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnchorError';
  }
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
 * Anchor Manager Service
 * 앵커 상태 관리 및 국소 검색 기능 제공
 */
export class AnchorManager {
  /**
   * 메모리 캐시: agent_id별 슬롯 상태 관리
   * Map<agent_id, {A: memory_id | null, B: memory_id | null, C: memory_id | null}>
   */
  private cache: Map<string, { A: string | null; B: string | null; C: string | null }> = new Map();

  /**
   * 쿼리 임베딩 서비스
   */
  private queryEmbeddingService: UnifiedEmbeddingService = new UnifiedEmbeddingService();

  /**
   * 슬롯별 설정
   */
  private readonly slotConfig = {
    A: { hop_limit: 1, vector_threshold: 0.8 },
    B: { hop_limit: 2, vector_threshold: 0.6 },
    C: { hop_limit: 3, vector_threshold: 0.4 }
  } as const;

  private db: Database.Database | null = null;
  private embeddingService: MemoryEmbeddingService | null = null;
  private hybridSearchEngine: HybridSearchEngine | null = null;
  private vectorSearchEngine: ReturnType<typeof getVectorSearchEngine> | null = null;

  /**
   * 생성자
   */
  constructor() {
    console.log('✅ AnchorManager 서비스 초기화 완료');
  }

  /**
   * 데이터베이스 설정
   * @param db - 데이터베이스 인스턴스
   */
  setDatabase(db: Database.Database): void {
    if (!db) {
      throw new Error('Database instance is required');
    }
    this.db = db;
    // VectorSearchEngine이 설정되어 있으면 초기화
    if (this.vectorSearchEngine) {
      this.vectorSearchEngine.initialize(db);
    }
  }

  /**
   * 임베딩 서비스 설정
   * @param embeddingService - 메모리 임베딩 서비스 인스턴스
   */
  setEmbeddingService(embeddingService: MemoryEmbeddingService): void {
    if (!embeddingService) {
      throw new Error('MemoryEmbeddingService is required');
    }
    this.embeddingService = embeddingService;
  }

  /**
   * 하이브리드 검색 엔진 설정
   * @param hybridSearchEngine - 하이브리드 검색 엔진 인스턴스
   */
  setHybridSearchEngine(hybridSearchEngine: HybridSearchEngine): void {
    if (!hybridSearchEngine) {
      throw new Error('HybridSearchEngine is required');
    }
    this.hybridSearchEngine = hybridSearchEngine;
  }

  /**
   * 벡터 검색 엔진 설정
   * @param vectorSearchEngine - 벡터 검색 엔진 인스턴스
   */
  setVectorSearchEngine(vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>): void {
    if (!vectorSearchEngine) {
      throw new Error('VectorSearchEngine is required');
    }
    this.vectorSearchEngine = vectorSearchEngine;
    // 데이터베이스가 이미 설정되어 있으면 초기화
    if (this.db) {
      this.vectorSearchEngine.initialize(this.db);
    }
  }

  /**
   * 앵커 설정
   * @param agentId - 에이전트 ID
   * @param memoryId - 메모리 ID
   * @param slot - 슬롯 (A, B, C)
   * @throws {MemoryNotFoundError} 메모리가 존재하지 않는 경우
   * @throws {AnchorError} 동일한 memory_id를 다른 슬롯에 이미 설정한 경우
   */
  async setAnchor(agentId: string, memoryId: string, slot: AnchorSlot): Promise<void> {
    if (!this.db) {
      throw new Error('Database is not set. Call setDatabase() first.');
    }

    // 메모리 존재 확인
    const memory = this.db.prepare(`
      SELECT id FROM memory_item WHERE id = ?
    `).get(memoryId) as { id: string } | undefined;

    if (!memory) {
      throw new MemoryNotFoundError(memoryId);
    }

    // 동일한 agent_id가 동일한 memory_id를 다른 슬롯에 이미 설정했는지 확인
    const existingAnchor = this.db.prepare(`
      SELECT slot FROM anchor 
      WHERE agent_id = ? AND memory_id = ? AND slot != ?
    `).get(agentId, memoryId, slot) as { slot: string } | undefined;

    if (existingAnchor) {
      throw new AnchorError(
        `Memory '${memoryId}' is already set as anchor in slot '${existingAnchor.slot}'. ` +
        `An agent cannot set the same memory in multiple slots.`
      );
    }

    // 기존 앵커가 있으면 업데이트, 없으면 삽입
    const existing = this.db.prepare(`
      SELECT id FROM anchor WHERE agent_id = ? AND slot = ?
    `).get(agentId, slot) as { id: number } | undefined;

    if (existing) {
      // 업데이트
      this.db.prepare(`
        UPDATE anchor 
        SET memory_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE agent_id = ? AND slot = ?
      `).run(memoryId, agentId, slot);
    } else {
      // 삽입
      this.db.prepare(`
        INSERT INTO anchor (agent_id, slot, memory_id)
        VALUES (?, ?, ?)
      `).run(agentId, slot, memoryId);
    }

    // 캐시 업데이트
    this.updateCache(agentId, slot, memoryId);
  }

  /**
   * 앵커 조회
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯 (A, B, C), 선택적. 없으면 모든 슬롯 반환
   * @returns 앵커 정보 또는 null
   */
  async getAnchor(agentId: string, slot?: AnchorSlot): Promise<AnchorInfo | AnchorInfo[] | null> {
    if (!this.db) {
      throw new Error('Database is not set. Call setDatabase() first.');
    }

    // 캐시에서 먼저 확인
    const cached = this.cache.get(agentId);
    
    if (slot) {
      // 특정 슬롯 조회
      const cachedMemoryId = cached?.[slot];
      
      if (cachedMemoryId !== undefined) {
        // 캐시에 있으면 DB에서 상세 정보 조회
        const anchor = this.db.prepare(`
          SELECT agent_id, slot, memory_id, created_at, updated_at
          FROM anchor
          WHERE agent_id = ? AND slot = ?
        `).get(agentId, slot) as AnchorInfo | undefined;

        return anchor || null;
      }
    } else {
      // 모든 슬롯 조회
      if (cached) {
        // 캐시에 있으면 DB에서 상세 정보 조회
        const anchors = this.db.prepare(`
          SELECT agent_id, slot, memory_id, created_at, updated_at
          FROM anchor
          WHERE agent_id = ?
          ORDER BY slot
        `).all(agentId) as AnchorInfo[];

        return anchors;
      }
    }

    // 캐시에 없으면 DB에서 조회 후 캐시 업데이트
    if (slot) {
      const anchor = this.db.prepare(`
        SELECT agent_id, slot, memory_id, created_at, updated_at
        FROM anchor
        WHERE agent_id = ? AND slot = ?
      `).get(agentId, slot) as AnchorInfo | undefined;

      if (anchor) {
        this.updateCache(agentId, slot, anchor.memory_id);
      }

      return anchor || null;
    } else {
      const anchors = this.db.prepare(`
        SELECT agent_id, slot, memory_id, created_at, updated_at
        FROM anchor
        WHERE agent_id = ?
        ORDER BY slot
      `).all(agentId) as AnchorInfo[];

      // 캐시 업데이트
      for (const anchor of anchors) {
        this.updateCache(anchor.agent_id, anchor.slot, anchor.memory_id);
      }

      return anchors.length > 0 ? anchors : null;
    }
  }

  /**
   * 앵커 제거
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯 (A, B, C), 선택적. 없으면 모든 슬롯 제거
   */
  async clearAnchor(agentId: string, slot?: AnchorSlot): Promise<void> {
    if (!this.db) {
      throw new Error('Database is not set. Call setDatabase() first.');
    }

    if (slot) {
      // 특정 슬롯 제거
      this.db.prepare(`
        DELETE FROM anchor WHERE agent_id = ? AND slot = ?
      `).run(agentId, slot);

      // 캐시 업데이트
      this.updateCache(agentId, slot, null);
    } else {
      // 모든 슬롯 제거
      this.db.prepare(`
        DELETE FROM anchor WHERE agent_id = ?
      `).run(agentId);

      // 캐시에서 제거
      this.cache.delete(agentId);
    }
  }

  /**
   * 국소 검색
   * 앵커 메모리를 기준으로 N-hop 제한 검색 수행
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯 (A, B, C)
   * @param query - 검색 쿼리 (선택적)
   * @param hopLimit - Hop 제한 (선택적, 기본값: 슬롯별 설정값)
   * @param options - 검색 옵션
   * @returns 검색 결과
   */
  async searchLocal(
    agentId: string,
    slot: AnchorSlot,
    query?: string,
    hopLimit?: number,
    options?: SearchOptions
  ): Promise<SearchResult> {
    const startTime = Date.now();

    if (!this.db) {
      throw new Error('Database is not set. Call setDatabase() first.');
    }

    if (!this.embeddingService) {
      throw new Error('MemoryEmbeddingService is not set. Call setEmbeddingService() first.');
    }

    // 앵커 조회
    const anchor = await this.getAnchor(agentId, slot);
    if (!anchor || Array.isArray(anchor) || !anchor.memory_id) {
      // 앵커가 없거나 memory_id가 NULL인 경우 (Edge Case: 앵커 없음 또는 메모리 삭제)
      console.warn(`⚠️ No anchor set for agent '${agentId}' in slot '${slot}' (memory_id is NULL)`);
      
      if (!query) {
        // query가 없으면 에러 반환 (앵커 기반 리콜은 앵커가 필수)
        throw new AnchorError(
          `No anchor set for agent '${agentId}' in slot '${slot}'. ` +
          `Anchor is required for anchor-based recall. ` +
          `If the anchor memory was deleted, please set a new anchor.`
        );
      }
      // query가 있으면 전역 검색으로 fallback
      console.log(`🔄 Anchor missing, falling back to global search for query: "${query}"`);
      return await this.fallbackToGlobalSearch(query, options, startTime);
    }

    // 슬롯별 설정 가져오기
    const slotConfig = this.getSlotConfig(slot);
    const finalHopLimit = hopLimit ?? slotConfig.hop_limit;
    const vectorThreshold = slotConfig.vector_threshold;

    // 검색 옵션 기본값
    const limit = options?.limit ?? 10;
    const minResults = options?.min_results ?? 3;

    // 앵커 메모리 임베딩 조회 (Edge Case: 임베딩 없음, 메모리 삭제)
    let anchorEmbedding = await this.getAnchorEmbedding(anchor.memory_id);
    if (!anchorEmbedding) {
      // 임베딩이 없으면 메모리 존재 확인 후 생성 시도
      const memory = this.db.prepare(`
        SELECT id, content, type FROM memory_item WHERE id = ?
      `).get(anchor.memory_id) as { id: string; content: string; type: string } | undefined;

      if (!memory) {
        // Edge Case: 메모리가 삭제된 경우
        console.warn(`⚠️ Anchor memory '${anchor.memory_id}' not found (may have been deleted)`);
        
        // 앵커를 자동으로 정리 (선택적)
        try {
          await this.clearAnchor(agentId, slot);
          console.log(`🧹 Cleared invalid anchor for agent '${agentId}' in slot '${slot}'`);
        } catch (error) {
          console.error(`❌ Failed to clear invalid anchor:`, error);
        }
        
        // query가 있으면 전역 검색으로 fallback
        if (query) {
          console.log(`🔄 Anchor memory deleted, falling back to global search for query: "${query}"`);
          return await this.fallbackToGlobalSearch(query, options, startTime);
        }
        
        // query가 없으면 에러 반환
        throw new MemoryNotFoundError(
          anchor.memory_id + 
          ` (Memory may have been deleted. Please set a new anchor.)`
        );
      }

      // Edge Case: 임베딩 없음 - 생성 시도
      console.log(`🔄 Generating embedding for anchor memory '${anchor.memory_id}'`);
      const embeddingResult = await this.embeddingService.createAndStoreEmbedding(
        this.db,
        memory.id,
        memory.content,
        memory.type as any
      );

      if (!embeddingResult) {
        throw new Error(
          `Failed to generate embedding for anchor memory '${anchor.memory_id}'. ` +
          `Please check if the embedding service is available.`
        );
      }

      // 생성된 임베딩 다시 조회
      const newEmbedding = await this.getAnchorEmbedding(anchor.memory_id);
      if (!newEmbedding) {
        throw new Error(
          `Failed to retrieve newly created embedding for '${anchor.memory_id}'. ` +
          `Please try again or check the database.`
        );
      }

      // 새로 생성된 임베딩 사용
      anchorEmbedding = newEmbedding;
      console.log(`✅ Embedding generated and retrieved for anchor memory '${anchor.memory_id}'`);
    }

    // VectorSearchEngine이 없으면 생성
    if (!this.vectorSearchEngine) {
      this.vectorSearchEngine = getVectorSearchEngine();
      if (this.db) {
        this.vectorSearchEngine.initialize(this.db);
      }
    }

    // N-hop 검색 구현
    const allHopResults = await this.searchNHop(
      anchorEmbedding.embedding,
      anchorEmbedding.provider,
      anchor.memory_id,
      vectorThreshold,
      finalHopLimit,
      limit * 2 // 더 많이 가져와서 필터링 후 최종 limit 적용
    );

    // 쿼리가 있는 경우 쿼리 기반 필터링 (작업 3.7)
    let filteredResults = allHopResults;
    let queryEmbeddingForReanchor: number[] | undefined;
    if (query && query.trim().length > 0) {
      filteredResults = await this.filterByQuery(query, allHopResults, anchorEmbedding.provider);
      
      // 자동 앵커 이동을 위한 쿼리 임베딩 생성 (선택적, 비동기)
      try {
        const queryEmbeddingResult = await this.queryEmbeddingService.generateEmbedding(query);
        if (queryEmbeddingResult && queryEmbeddingResult.embedding) {
          queryEmbeddingForReanchor = queryEmbeddingResult.embedding;
        }
      } catch (error) {
        // 쿼리 임베딩 생성 실패는 무시 (자동 이동은 선택적)
        console.debug('쿼리 임베딩 생성 실패 (자동 앵커 이동용):', error);
      }
    }

    // 결과 포맷팅
    const formattedResults = filteredResults.map(result => ({
      id: result.memory_id,
      content: result.content,
      type: result.type,
      similarity: result.similarity,
      hop_distance: result.hop_distance,
      importance: result.importance,
      created_at: result.created_at,
      tags: result.tags
    }));

    // 최종 limit 적용
    const localResults = formattedResults.slice(0, limit);
    const localCount = localResults.length;

    // Fallback 체크 (query가 있을 때만, min_results 미만 시)
    let fallbackUsed = false;
    let finalResults = localResults;
    let totalCount = localCount;

    if (query && query.trim().length > 0 && localCount < minResults) {
      try {
        console.log(`🔄 Fallback to global search: local results (${localCount}) < min_results (${minResults})`);
        
        // Fallback 수행
        const fallbackResult = await this.fallbackToGlobalSearch(
          query,
          { ...options, limit: limit - localCount }, // 부족한 만큼만 가져오기
          startTime
        );

        fallbackUsed = true;

        // Local 결과와 Fallback 결과 병합
        // Local 결과를 우선하고, 중복 제거 (memory_id 기준)
        const localMemoryIds = new Set(localResults.map(r => r.id));
        const fallbackItems: Array<{
          id: string;
          content: string;
          type: string;
          similarity: number;
          hop_distance: number;
          importance: number;
          created_at: string;
          tags: string[] | undefined;
        }> = fallbackResult.items
          .filter(item => !localMemoryIds.has(item.id))
          .map(item => ({
            id: item.id,
            content: item.content,
            type: item.type,
            similarity: item.similarity ?? 0,
            hop_distance: item.hop_distance ?? 999, // fallback 결과는 hop_distance가 없으므로 큰 값으로 설정
            importance: item.importance ?? 0.5,
            created_at: item.created_at ?? new Date().toISOString(),
            tags: item.tags ?? undefined
          }));

        // Local 결과 + Fallback 결과 (중복 제거된 것만)
        finalResults = [...localResults, ...fallbackItems].slice(0, limit);
        totalCount = finalResults.length;

        console.log(`✅ Fallback 완료: local ${localCount} + fallback ${fallbackItems.length} = total ${totalCount}`);
      } catch (error) {
        console.error('❌ Fallback 실패:', error);
        // Fallback 실패 시 local 결과만 반환
        fallbackUsed = false;
      }
    }

    // 자동 앵커 이동 체크 (query가 있고 queryEmbeddingForReanchor가 생성된 경우)
    // 기본적으로 활성화되어 있으며, options에 autoMoveEnabled: false를 전달하여 비활성화 가능
    if (queryEmbeddingForReanchor && options?.autoMoveEnabled !== false) {
      try {
        await this.checkAndAutoReanchor(agentId, slot, queryEmbeddingForReanchor, true);
      } catch (error) {
        // 자동 앵커 이동 실패는 검색 결과에 영향을 주지 않음
        console.debug('⚠️ 자동 앵커 이동 체크 실패 (무시됨):', error);
      }
    }

    const queryTime = Date.now() - startTime;
    return {
      items: finalResults,
      total_count: totalCount,
      local_results_count: localCount,
      fallback_used: fallbackUsed,
      query_time: queryTime,
      anchor_info: {
        agent_id: agentId,
        slot: slot,
        memory_id: anchor.memory_id
      }
    };
  }

  /**
   * 앵커 메모리의 임베딩 조회
   * @param memoryId - 메모리 ID
   * @returns 임베딩 벡터 및 제공자 정보, 없으면 null
   * @throws {MemoryNotFoundError} 메모리가 삭제된 경우
   */
  private async getAnchorEmbedding(memoryId: string): Promise<{ embedding: number[]; provider: string } | null> {
    if (!this.db) {
      throw new Error('Database is not set.');
    }

    try {
      // Edge Case: 메모리 존재 확인 (메모리 삭제 체크)
      const memoryExists = this.db.prepare(`
        SELECT id FROM memory_item WHERE id = ?
      `).get(memoryId) as { id: string } | undefined;

      if (!memoryExists) {
        // 메모리가 삭제된 경우
        console.warn(`⚠️ Memory '${memoryId}' not found (may have been deleted)`);
        return null;
      }

      const embeddingRecord = this.db.prepare(`
        SELECT 
          embedding,
          embedding_provider,
          dimensions,
          dim
        FROM memory_embedding
        WHERE memory_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(memoryId) as {
        embedding: string | number[];
        embedding_provider?: string;
        dimensions?: number;
        dim?: number;
      } | undefined;

      if (!embeddingRecord || !embeddingRecord.embedding) {
        // Edge Case: 임베딩 없음 (메모리는 존재하지만 임베딩이 없음)
        return null;
      }

      // JSON 문자열로 저장된 임베딩을 배열로 파싱
      let embeddingVector: number[];
      try {
        embeddingVector = typeof embeddingRecord.embedding === 'string'
          ? JSON.parse(embeddingRecord.embedding)
          : embeddingRecord.embedding;

        if (!Array.isArray(embeddingVector) || embeddingVector.length === 0) {
          // Edge Case: 유효하지 않은 임베딩
          console.warn(`⚠️ Invalid embedding for memory '${memoryId}' (empty or not an array)`);
          return null;
        }
      } catch (error) {
        // Edge Case: 임베딩 파싱 실패
        console.error(`❌ 임베딩 파싱 실패 (${memoryId}):`, error);
        return null;
      }

      const provider = embeddingRecord.embedding_provider || 'tfidf';

      return {
        embedding: embeddingVector,
        provider: provider
      };
    } catch (error) {
      // Edge Case: 데이터베이스 오류
      console.error(`❌ 임베딩 조회 실패 (${memoryId}):`, error);
      return null;
    }
  }

  /**
   * 1-hop 검색: 앵커와 직접적으로 유사한 메모리 검색
   * @param anchorEmbedding - 앵커 메모리의 임베딩 벡터
   * @param provider - 임베딩 제공자
   * @param anchorMemoryId - 앵커 메모리 ID (제외할 메모리)
   * @param threshold - 유사도 임계값
   * @param limit - 최대 결과 수
   * @returns 검색 결과
   */
  private async searchOneHop(
    anchorEmbedding: number[],
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    limit: number
  ): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    similarity: number;
    importance: number;
    created_at: string;
    tags?: string[];
  }>> {
    if (!this.vectorSearchEngine || !this.db) {
      throw new Error('VectorSearchEngine or Database is not set.');
    }

    try {
      // VectorSearchEngine 초기화 확인
      if (typeof (this.vectorSearchEngine as any).initialize === 'function') {
        (this.vectorSearchEngine as any).initialize(this.db);
      }

      // 벡터 검색 실행 (임계값은 낮게 설정하고 나중에 필터링)
      const searchResults = await this.vectorSearchEngine.search(
        anchorEmbedding,
        {
          limit: limit + 1, // 자기 자신 제외를 위해 +1
          threshold: 0.0, // 임계값은 나중에 필터링에서 적용
          includeContent: true,
          includeMetadata: true
        },
        provider
      );

      // 결과 필터링: 앵커 메모리 제외, 유사도 임계값 이상만 반환
      const filteredResults = searchResults
        .filter(result => {
          // 앵커 메모리 제외
          if (result.memory_id === anchorMemoryId) {
            return false;
          }
          // 유사도 임계값 이상만 반환
          return result.similarity >= threshold;
        })
        .slice(0, limit); // 최종 limit 적용

      return filteredResults;
    } catch (error) {
      console.error(`❌ 1-hop 검색 실패:`, error);
      throw new Error(`Failed to perform 1-hop search: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * N-hop 검색: 앵커를 기준으로 최대 N-hop까지 확장 검색
   * @param anchorEmbedding - 앵커 메모리의 임베딩 벡터
   * @param provider - 임베딩 제공자
   * @param anchorMemoryId - 앵커 메모리 ID (제외할 메모리)
   * @param threshold - 유사도 임계값
   * @param maxHops - 최대 hop 수
   * @param limit - 최대 결과 수 (전체 hop 합계)
   * @returns 검색 결과 (hop_distance 포함)
   */
  private async searchNHop(
    anchorEmbedding: number[],
    provider: string,
    anchorMemoryId: string,
    threshold: number,
    maxHops: number,
    limit: number
  ): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    similarity: number;
    hop_distance: number;
    importance: number;
    created_at: string;
    tags?: string[];
  }>> {
    if (!this.vectorSearchEngine || !this.db) {
      throw new Error('VectorSearchEngine or Database is not set.');
    }

    // VectorSearchEngine 초기화 확인
    if (typeof (this.vectorSearchEngine as any).initialize === 'function') {
      (this.vectorSearchEngine as any).initialize(this.db);
    }

    // 이미 발견된 메모리 ID 추적 (중복 방지)
    const discoveredMemoryIds = new Set<string>([anchorMemoryId]);
    
    // 각 hop 레벨의 결과를 저장
    const allResults: Array<{
      memory_id: string;
      content: string;
      type: string;
      similarity: number;
      hop_distance: number;
      importance: number;
      created_at: string;
      tags?: string[];
    }> = [];

    // 현재 hop 레벨의 메모리들 (임베딩 포함)
    // 1-hop: 앵커 임베딩을 사용
    let currentHopMemories: Array<{ memory_id: string; embedding: number[] }> = [
      { memory_id: anchorMemoryId, embedding: anchorEmbedding }
    ];

    // 각 hop 레벨별로 검색 수행
    for (let hop = 1; hop <= maxHops; hop++) {
      const nextHopMemories: Array<{ memory_id: string; embedding: number[] }> = [];
      const hopResults: Array<{
        memory_id: string;
        content: string;
        type: string;
        similarity: number;
        importance: number;
        created_at: string;
        tags?: string[];
      }> = [];

      // 현재 hop의 각 메모리에 대해 검색 수행
      for (const currentMemory of currentHopMemories) {
        try {
          // memory_link를 활용한 직접 연결된 메모리 조회 (최적화)
          const linkedMemories = await this.getLinkedMemories(currentMemory.memory_id);
          
          // 벡터 검색 실행
          const vectorSearchResults = await this.vectorSearchEngine.search(
            currentMemory.embedding,
            {
              limit: Math.ceil(limit / maxHops) + 10, // 각 hop당 충분한 결과 가져오기
              threshold: 0.0, // 임계값은 나중에 필터링에서 적용
              includeContent: true,
              includeMetadata: true
            },
            provider
          );

          // 디버깅: 벡터 검색 결과 로깅
          if (hop === 1 && currentMemory.memory_id === anchorMemoryId) {
            console.log(`🔍 [Debug] 벡터 검색 결과 (${hop}-hop, 앵커: ${anchorMemoryId}):`, {
              totalResults: vectorSearchResults.length,
              top5Similarities: vectorSearchResults.slice(0, 5).map(r => ({
                memory_id: r.memory_id,
                similarity: r.similarity.toFixed(4)
              })),
              threshold,
              provider
            });
          }

          // memory_link 결과와 벡터 검색 결과를 병합
          // memory_link 결과는 우선순위가 높음 (직접 연결된 관계)
          const allCandidates = new Map<string, {
            memory_id: string;
            content: string;
            type: string;
            similarity: number;
            importance: number;
            created_at: string;
            tags?: string[];
            isLinked: boolean; // memory_link를 통한 연결 여부
          }>();

          // memory_link 결과 추가 (우선순위 높음)
          for (const linked of linkedMemories) {
            if (!discoveredMemoryIds.has(linked.memory_id)) {
              allCandidates.set(linked.memory_id, {
                ...linked,
                isLinked: true
              });
            }
          }

          // 벡터 검색 결과 추가 (memory_link에 없는 경우만)
          // 임계값을 낮춰서 더 많은 결과를 포함 (나중에 effectiveThreshold로 재필터링)
          const relaxedThreshold = threshold * 0.5; // 임계값을 50%로 완화하여 후보 확보
          for (const result of vectorSearchResults) {
            if (!allCandidates.has(result.memory_id) && !discoveredMemoryIds.has(result.memory_id)) {
              // 완화된 임계값으로 후보 추가 (나중에 effectiveThreshold로 재필터링)
              if (result.similarity >= relaxedThreshold) {
                allCandidates.set(result.memory_id, {
                  ...result,
                  isLinked: false
                });
              }
            } else if (allCandidates.has(result.memory_id)) {
              // memory_link로 이미 추가된 경우, 유사도 정보 업데이트
              const existing = allCandidates.get(result.memory_id)!;
              existing.similarity = Math.max(existing.similarity, result.similarity);
            }
          }

          // 결과 필터링 및 추가
          for (const [memoryId, candidate] of allCandidates.entries()) {
            // 이미 발견된 메모리 제외
            if (discoveredMemoryIds.has(memoryId)) {
              continue;
            }

            // 유사도 임계값 이상만 반환 (memory_link는 임계값 완화 가능)
            const effectiveThreshold = candidate.isLinked 
              ? threshold * 0.8 // memory_link 연결은 임계값 20% 완화
              : threshold;
            
            if (candidate.similarity < effectiveThreshold) {
              continue;
            }

            // 새로 발견된 메모리
            discoveredMemoryIds.add(memoryId);
            hopResults.push({
              memory_id: candidate.memory_id,
              content: candidate.content,
              type: candidate.type,
              similarity: candidate.similarity,
              importance: candidate.importance,
              created_at: candidate.created_at,
              tags: candidate.tags
            });

            // 다음 hop을 위한 임베딩 조회 (다음 hop이 있을 경우)
            // Edge Case: 중간 hop의 메모리가 삭제되거나 임베딩이 없는 경우 무시
            if (hop < maxHops) {
              try {
                const nextEmbedding = await this.getAnchorEmbedding(candidate.memory_id);
                if (nextEmbedding && nextEmbedding.embedding) {
                  nextHopMemories.push({
                    memory_id: candidate.memory_id,
                    embedding: nextEmbedding.embedding
                  });
                } else {
                  // 임베딩이 없으면 다음 hop에서 제외 (경고 없이)
                  console.debug(`⚠️ Skipping memory '${candidate.memory_id}' for next hop: no embedding`);
                }
              } catch (error) {
                // 메모리 삭제 또는 임베딩 조회 실패 시 다음 hop에서 제외
                console.debug(`⚠️ Skipping memory '${candidate.memory_id}' for next hop: ${error instanceof Error ? error.message : 'Unknown error'}`);
              }
            }
          }
        } catch (error) {
          console.error(`❌ ${hop}-hop 검색 실패 (${currentMemory.memory_id}):`, error);
          // 개별 메모리 검색 실패는 무시하고 계속 진행
          continue;
        }
      }

      // 현재 hop의 결과를 전체 결과에 추가 (hop_distance 설정)
      for (const result of hopResults) {
        allResults.push({
          ...result,
          hop_distance: hop
        });
      }

      // limit에 도달했으면 중단
      if (allResults.length >= limit) {
        break;
      }

      // 다음 hop을 위한 메모리가 없으면 중단
      if (nextHopMemories.length === 0) {
        break;
      }

      // 다음 hop을 위한 메모리로 업데이트
      currentHopMemories = nextHopMemories;
    }

    // 랭킹 점수 계산 및 적용 (hop 거리 기반 점수 + 앵커 근처 부스트)
    const rankedResults = allResults.map(result => {
      const rankingScore = this.calculateRankingScore(
        result.similarity,
        result.hop_distance,
        result.importance
      );
      return {
        ...result,
        similarity: rankingScore // 랭킹 점수로 업데이트
      };
    });

    // 랭킹 점수 기준으로 정렬 (높은 점수 우선)
    rankedResults.sort((a, b) => {
      // 점수가 같으면 hop 거리가 가까운 것 우선
      if (Math.abs(a.similarity - b.similarity) < 0.001) {
        return a.hop_distance - b.hop_distance;
      }
      // 점수가 높은 것 우선
      return b.similarity - a.similarity;
    });

    // 최종 limit 적용
    return rankedResults.slice(0, limit);
  }

  /**
   * 쿼리 기반 필터링: 앵커 주변 검색 결과 중 쿼리와 관련된 메모리만 필터링
   * @param query - 검색 쿼리
   * @param results - 앵커 주변 검색 결과
   * @param provider - 임베딩 제공자
   * @returns 필터링된 결과 (쿼리 관련성 점수 포함)
   */
  private async filterByQuery(
    query: string,
    results: Array<{
      memory_id: string;
      content: string;
      type: string;
      similarity: number;
      hop_distance: number;
      importance: number;
      created_at: string;
      tags?: string[];
    }>,
    provider: string
  ): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    similarity: number;
    hop_distance: number;
    importance: number;
    created_at: string;
    tags?: string[];
  }>> {
    if (results.length === 0) {
      return results;
    }

    try {
      // 1. 쿼리 임베딩 생성
      const queryEmbeddingResult = await this.queryEmbeddingService.generateEmbedding(query);
      if (!queryEmbeddingResult || !queryEmbeddingResult.embedding) {
        console.warn('⚠️ 쿼리 임베딩 생성 실패, 필터링 건너뜀');
        return results;
      }

      const queryEmbedding = queryEmbeddingResult.embedding;

      // 2. 각 결과 메모리의 임베딩 조회 및 쿼리 유사도 계산
      const resultsWithQuerySimilarity = await Promise.all(
        results.map(async (result) => {
          try {
            // 메모리 임베딩 조회
            const memoryEmbedding = await this.getAnchorEmbedding(result.memory_id);
            if (!memoryEmbedding || !memoryEmbedding.embedding) {
              // 임베딩이 없으면 쿼리 유사도 0으로 설정
              return {
                ...result,
                query_similarity: 0,
                combined_similarity: result.similarity * 0.5 // 앵커 유사도만 반영
              };
            }

            // 쿼리 임베딩과 메모리 임베딩 간 유사도 계산
            // 차원이 다를 수 있으므로 호환성 확인
            let querySim = 0;
            if (queryEmbedding.length === memoryEmbedding.embedding.length) {
              querySim = this.cosineSimilarity(queryEmbedding, memoryEmbedding.embedding);
            } else {
              // 차원이 다르면 텍스트 기반 간단한 매칭 (fallback)
              const queryLower = query.toLowerCase();
              const contentLower = result.content.toLowerCase();
              const queryWords = queryLower.split(/\s+/);
              const matchCount = queryWords.filter(word => contentLower.includes(word)).length;
              querySim = matchCount / Math.max(queryWords.length, 1);
            }

            // hop 거리 기반 랭킹 점수 계산
            const baseRankingScore = this.calculateRankingScore(
              result.similarity,
              result.hop_distance,
              result.importance
            );
            
            // 결합 유사도: 랭킹 점수(60%) + 쿼리 유사도(40%)
            const combinedSimilarity = baseRankingScore * 0.6 + querySim * 0.4;

            return {
              ...result,
              query_similarity: querySim,
              combined_similarity: combinedSimilarity
            };
          } catch (error) {
            console.error(`❌ 쿼리 필터링 실패 (${result.memory_id}):`, error);
            // 에러 발생 시 원본 similarity 사용
            return {
              ...result,
              query_similarity: 0,
              combined_similarity: result.similarity * 0.5
            };
          }
        })
      );

      // 3. 쿼리 유사도 임계값 적용 (0.3 이상만 유지)
      const queryThreshold = 0.3;
      const filtered = resultsWithQuerySimilarity.filter(
        r => r.query_similarity >= queryThreshold || r.combined_similarity >= 0.5
      );

      // 4. 결합 유사도 기준으로 재정렬
      filtered.sort((a, b) => {
        // 결합 유사도가 같으면 hop 거리가 가까운 것 우선
        if (Math.abs(a.combined_similarity - b.combined_similarity) < 0.001) {
          return a.hop_distance - b.hop_distance;
        }
        // 결합 유사도가 높은 것 우선
        return b.combined_similarity - a.combined_similarity;
      });

      // 5. 원본 similarity를 combined_similarity로 업데이트하여 반환
      return filtered.map(r => ({
        ...r,
        similarity: r.combined_similarity
      }));
    } catch (error) {
      console.error('❌ 쿼리 기반 필터링 실패:', error);
      // 에러 발생 시 원본 결과 반환
      return results;
    }
  }

  /**
   * 검색 결과 랭킹 점수 계산 (hop 거리 기반 점수 + 앵커 근처 부스트)
   * @param similarity - 벡터 유사도 (0-1)
   * @param hopDistance - hop 거리 (1부터 시작)
   * @param importance - 메모리 중요도 (0-1)
   * @returns 랭킹 점수 (0-1)
   */
  private calculateRankingScore(
    similarity: number,
    hopDistance: number,
    importance: number = 0.5
  ): number {
    // 1. Hop 거리 기반 점수 감쇠 (거리가 멀수록 점수 감소)
    // hop_distance=1: 1.0, hop_distance=2: 0.7, hop_distance=3: 0.5
    const hopDecayFactor = 1.0 / (1.0 + (hopDistance - 1) * 0.3);
    
    // 2. 앵커 근처 부스트 (1-hop은 추가 부스트)
    const anchorProximityBoost = hopDistance === 1 ? 1.2 : 1.0; // 1-hop은 20% 부스트
    
    // 3. 중요도 가중치 (0.1 가중치)
    const importanceWeight = 0.1;
    const importanceBoost = 1.0 + (importance - 0.5) * importanceWeight;
    
    // 4. 최종 랭킹 점수 계산
    // 기본 공식: similarity * hop_decay * proximity_boost * importance_boost
    // 점수가 1.0을 초과하지 않도록 클램프
    const rankingScore = Math.min(
      1.0,
      similarity * hopDecayFactor * anchorProximityBoost * importanceBoost
    );
    
    return rankingScore;
  }

  /**
   * 코사인 유사도 계산
   * @param a - 벡터 A
   * @param b - 벡터 B
   * @returns 코사인 유사도 (0-1)
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('벡터 차원이 일치하지 않습니다');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * memory_link 테이블을 활용한 직접 연결된 메모리 조회
   * @param memoryId - 메모리 ID
   * @returns 연결된 메모리 목록 (임베딩 정보 포함)
   */
  private async getLinkedMemories(memoryId: string): Promise<Array<{
    memory_id: string;
    content: string;
    type: string;
    similarity: number; // memory_link 연결은 높은 유사도로 간주 (0.9)
    importance: number;
    created_at: string;
    tags?: string[];
  }>> {
    if (!this.db) {
      return [];
    }

    try {
      // memory_link를 통해 연결된 메모리 조회
      const linkedRecords = this.db.prepare(`
        SELECT 
          ml.target_id as memory_id,
          mi.content,
          mi.type,
          mi.importance,
          mi.created_at,
          mi.tags,
          ml.relation_type
        FROM memory_link ml
        JOIN memory_item mi ON mi.id = ml.target_id
        WHERE ml.source_id = ?
        ORDER BY ml.created_at DESC
      `).all(memoryId) as Array<{
        memory_id: string;
        content: string;
        type: string;
        importance: number;
        created_at: string;
        tags?: string;
        relation_type: string;
      }>;

      // 결과 포맷팅
      return linkedRecords.map(record => ({
        memory_id: record.memory_id,
        content: record.content,
        type: record.type,
        similarity: 0.9, // memory_link 연결은 높은 유사도로 간주
        importance: record.importance,
        created_at: record.created_at,
        tags: record.tags ? (typeof record.tags === 'string' ? JSON.parse(record.tags) : record.tags) : undefined
      }));
    } catch (error) {
      console.error(`❌ memory_link 조회 실패 (${memoryId}):`, error);
      return [];
    }
  }

  /**
   * 전역 검색으로 Fallback
   * @param query - 검색 쿼리
   * @param options - 검색 옵션
   * @param startTime - 시작 시간
   * @returns 검색 결과
   */
  private async fallbackToGlobalSearch(
    query: string,
    options?: SearchOptions,
    startTime?: number
  ): Promise<SearchResult> {
    if (!this.hybridSearchEngine) {
      throw new Error('HybridSearchEngine is not set. Call setHybridSearchEngine() first.');
    }

    if (!this.db) {
      throw new Error('Database is not set.');
    }

    const limit = options?.limit ?? 10;
    const fallbackStartTime = Date.now();

    try {
      // HybridSearchEngine을 사용한 전역 검색
      const globalSearchResult = await this.hybridSearchEngine.search(this.db, {
        query: query,
        limit: limit,
        vectorWeight: options?.vector_weight,
        textWeight: options?.text_weight
      });

      // HybridSearchResult를 SearchResult 형식으로 변환
      const convertedItems = globalSearchResult.items.map(item => ({
        id: item.id,
        content: item.content,
        type: item.type,
        similarity: item.finalScore, // finalScore를 similarity로 사용
        importance: item.importance,
        created_at: item.created_at,
        tags: item.tags,
        // fallback 결과는 hop_distance가 없음 (전역 검색이므로)
        hop_distance: undefined
      }));

      const queryTime = startTime ? Date.now() - startTime : Date.now() - fallbackStartTime;

      return {
        items: convertedItems,
        total_count: convertedItems.length,
        local_results_count: 0, // 전역 검색이므로 local 결과는 0
        fallback_used: true,
        query_time: queryTime
      };
    } catch (error) {
      console.error('❌ 전역 검색 Fallback 실패:', error);
      const queryTime = startTime ? Date.now() - startTime : 0;
      
      // 에러 발생 시 빈 결과 반환
      return {
        items: [],
        total_count: 0,
        local_results_count: 0,
        fallback_used: true,
        query_time: queryTime
      };
    }
  }

  /**
   * 서버 재시작 시 DB에서 캐시 복원
   * @param db - 데이터베이스 인스턴스
   */
  async restoreCacheFromDB(db: Database.Database): Promise<void> {
    if (!db) {
      throw new Error('Database instance is required');
    }

    try {
      // anchor 테이블 존재 여부 확인
      const tableExists = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='anchor'
      `).get() as { name: string } | undefined;

      if (!tableExists) {
        // 테이블이 없으면 빈 캐시로 시작 (마이그레이션이 아직 실행되지 않았을 수 있음)
        this.cache.clear();
        console.log('⚠️ Anchor table does not exist yet, starting with empty cache');
        return;
      }

      const anchors = db.prepare(`
        SELECT agent_id, slot, memory_id
        FROM anchor
        ORDER BY agent_id, slot
      `).all() as Array<{ agent_id: string; slot: string; memory_id: string | null }>;

      // 캐시 초기화
      this.cache.clear();

      // DB 데이터로 캐시 복원
      for (const anchor of anchors) {
        const agentId = anchor.agent_id;
        const slot = anchor.slot as AnchorSlot;
        const memoryId = anchor.memory_id;

        if (!this.cache.has(agentId)) {
          this.cache.set(agentId, { A: null, B: null, C: null });
        }

        const agentCache = this.cache.get(agentId)!;
        agentCache[slot] = memoryId;
      }

      console.log(`✅ Anchor cache restored: ${this.cache.size} agents`);
    } catch (error) {
      // 에러 발생 시 빈 캐시로 시작 (테이블이 없거나 다른 문제)
      this.cache.clear();
      console.warn('⚠️ Failed to restore anchor cache from DB, starting with empty cache:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 캐시 업데이트 헬퍼 메서드
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯
   * @param memoryId - 메모리 ID (null이면 제거)
   */
  private updateCache(agentId: string, slot: AnchorSlot, memoryId: string | null): void {
    if (!this.cache.has(agentId)) {
      this.cache.set(agentId, { A: null, B: null, C: null });
    }

    const agentCache = this.cache.get(agentId)!;
    agentCache[slot] = memoryId;
  }

  /**
   * 슬롯별 설정 조회
   * @param slot - 슬롯
   * @returns 슬롯 설정 (hop_limit, vector_threshold)
   */
  getSlotConfig(slot: AnchorSlot): { hop_limit: number; vector_threshold: number } {
    return this.slotConfig[slot];
  }

  /**
   * 자동 앵커 이동 점수 계산
   * 사용 빈도와 의미적 거리를 종합한 점수
   * @param memoryId - 메모리 ID
   * @param queryEmbedding - 검색 쿼리 임베딩 (선택적)
   * @param anchorEmbedding - 현재 앵커 임베딩 (선택적)
   * @returns 앵커 이동 점수 (0-1)
   */
  private async calculateReanchorScore(
    memoryId: string,
    queryEmbedding?: number[],
    anchorEmbedding?: number[]
  ): Promise<number> {
    if (!this.db) {
      return 0;
    }

    try {
      // 1. 사용 빈도 점수 계산 (view_count, cite_count, last_accessed 기반)
      const memory = this.db.prepare(`
        SELECT 
          view_count,
          cite_count,
          edit_count,
          last_accessed,
          created_at,
          importance
        FROM memory_item
        WHERE id = ?
      `).get(memoryId) as {
        view_count: number;
        cite_count: number;
        edit_count: number;
        last_accessed: string | null;
        created_at: string;
        importance: number;
      } | undefined;

      if (!memory) {
        return 0;
      }

      // 사용 빈도 점수 (로그 스케일)
      const usageScore = Math.min(
        1.0,
        (Math.log(1 + memory.view_count) +
         2 * Math.log(1 + memory.cite_count) +
         0.5 * Math.log(1 + memory.edit_count)) / 10 // 정규화
      );

      // 최근성 점수 (last_accessed 기반, 최근일수록 높음)
      let recencyScore = 0.5; // 기본값
      if (memory.last_accessed) {
        const lastAccessed = new Date(memory.last_accessed);
        const now = new Date();
        const daysSinceAccess = (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
        // 7일 이내면 높은 점수, 그 이후로 감소
        recencyScore = Math.max(0, 1.0 - daysSinceAccess / 30);
      }

      // 중요도 점수
      const importanceScore = memory.importance || 0.5;

      // 2. 의미적 거리 점수 계산 (query와의 유사도)
      let semanticScore = 0.5; // 기본값
      if (queryEmbedding) {
        const memoryEmbedding = await this.getAnchorEmbedding(memoryId);
        if (memoryEmbedding && memoryEmbedding.embedding) {
          const similarity = this.cosineSimilarity(queryEmbedding, memoryEmbedding.embedding);
          semanticScore = similarity;
        }
      }

      // 3. 현재 앵커와의 비교 (현재 앵커보다 더 나은지)
      let anchorComparisonScore = 0.5; // 기본값
      if (anchorEmbedding) {
        const memoryEmbedding = await this.getAnchorEmbedding(memoryId);
        if (memoryEmbedding && memoryEmbedding.embedding) {
          const similarity = this.cosineSimilarity(anchorEmbedding, memoryEmbedding.embedding);
          // 현재 앵커와 유사하면 낮은 점수, 다르면 높은 점수 (다양성)
          anchorComparisonScore = 1.0 - similarity;
        }
      }

      // 4. 종합 점수 계산 (가중 평균)
      // 사용 빈도(30%) + 최근성(20%) + 중요도(20%) + 의미적 거리(20%) + 앵커 비교(10%)
      const finalScore =
        usageScore * 0.3 +
        recencyScore * 0.2 +
        importanceScore * 0.2 +
        semanticScore * 0.2 +
        anchorComparisonScore * 0.1;

      return Math.min(1.0, Math.max(0.0, finalScore));
    } catch (error) {
      console.error(`❌ 앵커 이동 점수 계산 실패 (${memoryId}):`, error);
      return 0;
    }
  }

  /**
   * 앵커 주변 메모리 사용 패턴 분석
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯
   * @param queryEmbedding - 검색 쿼리 임베딩 (선택적)
   * @returns 더 적합한 앵커 후보 목록 (점수 내림차순)
   */
  async analyzeAnchorUsage(
    agentId: string,
    slot: AnchorSlot,
    queryEmbedding?: number[]
  ): Promise<Array<{ memory_id: string; score: number; reason: string }>> {
    if (!this.db) {
      throw new Error('Database is not set.');
    }

    const anchor = await this.getAnchor(agentId, slot);
    if (!anchor || Array.isArray(anchor) || !anchor.memory_id) {
      return [];
    }

    try {
      // 현재 앵커 임베딩 조회
      const anchorEmbedding = await this.getAnchorEmbedding(anchor.memory_id);
      if (!anchorEmbedding) {
        return [];
      }

      // 앵커 주변 메모리 검색 (1-hop)
      const slotConfig = this.getSlotConfig(slot);
      const nearbyMemories = await this.searchNHop(
        anchorEmbedding.embedding,
        anchorEmbedding.provider,
        anchor.memory_id,
        slotConfig.vector_threshold * 0.8, // 더 넓은 범위
        slotConfig.hop_limit,
        20 // 더 많은 후보
      );

      // 각 메모리에 대해 앵커 이동 점수 계산
      const candidates: Array<{ memory_id: string; score: number; reason: string }> = [];

      for (const memory of nearbyMemories) {
        const score = await this.calculateReanchorScore(
          memory.memory_id,
          queryEmbedding,
          anchorEmbedding.embedding
        );

        if (score > 0.5) { // 최소 점수 이상만 후보로
          const reason = this.generateReanchorReason(memory, score);
          candidates.push({
            memory_id: memory.memory_id,
            score,
            reason
          });
        }
      }

      // 점수 내림차순 정렬
      candidates.sort((a, b) => b.score - a.score);

      return candidates;
    } catch (error) {
      console.error(`❌ 앵커 사용 패턴 분석 실패 (${agentId}/${slot}):`, error);
      return [];
    }
  }

  /**
   * 앵커 이동 이유 생성
   */
  private generateReanchorReason(
    memory: { memory_id: string; content: string; similarity?: number; hop_distance?: number },
    score: number
  ): string {
    const reasons: string[] = [];

    if (score > 0.7) {
      reasons.push('높은 사용 빈도');
    }
    if (memory.similarity && memory.similarity > 0.8) {
      reasons.push('쿼리와 높은 유사도');
    }
    if (memory.hop_distance === 1) {
      reasons.push('앵커와 직접 연결');
    }

    return reasons.length > 0 ? reasons.join(', ') : '종합 점수 우수';
  }

  /**
   * 자동 앵커 이동 실행
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯
   * @param queryEmbedding - 검색 쿼리 임베딩 (선택적)
   * @param threshold - 이동 임계값 (기본값: 0.7)
   * @param strategy - 이동 전략 ('gradual' | 'immediate', 기본값: 'gradual')
   * @returns 이동 결과 (이동 여부, 새 앵커 정보)
   */
  async autoReanchor(
    agentId: string,
    slot: AnchorSlot,
    queryEmbedding?: number[],
    threshold: number = 0.7,
    strategy: 'gradual' | 'immediate' = 'gradual'
  ): Promise<{
    moved: boolean;
    old_anchor: string | null;
    new_anchor: string | null;
    score: number;
    reason: string;
  }> {
    if (!this.db) {
      throw new Error('Database is not set.');
    }

    try {
      // 현재 앵커 조회
      const currentAnchor = await this.getAnchor(agentId, slot);
      if (!currentAnchor || Array.isArray(currentAnchor) || !currentAnchor.memory_id) {
        return {
          moved: false,
          old_anchor: null,
          new_anchor: null,
          score: 0,
          reason: '앵커가 설정되지 않았습니다'
        };
      }

      // 더 적합한 앵커 후보 찾기
      const candidates = await this.analyzeAnchorUsage(agentId, slot, queryEmbedding);

      if (candidates.length === 0 || !candidates[0] || candidates[0].score < threshold) {
        return {
          moved: false,
          old_anchor: currentAnchor.memory_id,
          new_anchor: null,
          score: candidates[0]?.score || 0,
          reason: `임계값(${threshold}) 미만 또는 후보 없음`
        };
      }

      const bestCandidate = candidates[0];
      if (!bestCandidate) {
        return {
          moved: false,
          old_anchor: currentAnchor.memory_id,
          new_anchor: null,
          score: 0,
          reason: '후보 없음'
        };
      }

      // 이동 전략에 따라 처리
      if (strategy === 'gradual') {
        // 점진적 이동: 기존 앵커를 B나 C로 이동하고 새로운 메모리를 A에 설정
        if (slot === 'A') {
          // A -> B로 이동
          const bAnchor = await this.getAnchor(agentId, 'B');
          if (bAnchor && !Array.isArray(bAnchor) && bAnchor.memory_id) {
            // B -> C로 이동 (인자 순서: agentId, memoryId, slot)
            await this.setAnchor(agentId, bAnchor.memory_id, 'C');
          }
          // 현재 A -> B로 이동
          await this.setAnchor(agentId, currentAnchor.memory_id, 'B');
        } else if (slot === 'B') {
          // B -> C로 이동
          await this.setAnchor(agentId, currentAnchor.memory_id, 'C');
        }
        // 새로운 메모리를 현재 슬롯에 설정
        await this.setAnchor(agentId, bestCandidate.memory_id, slot);
      } else {
        // 급격한 이동: 현재 앵커를 완전히 교체
        await this.setAnchor(agentId, bestCandidate.memory_id, slot);
      }

      console.log(
        `🔄 자동 앵커 이동 완료: ${agentId}/${slot} ` +
        `${currentAnchor.memory_id} -> ${bestCandidate.memory_id} ` +
        `(점수: ${bestCandidate.score.toFixed(3)}, 이유: ${bestCandidate.reason})`
      );

      return {
        moved: true,
        old_anchor: currentAnchor.memory_id,
        new_anchor: bestCandidate.memory_id,
        score: bestCandidate.score,
        reason: bestCandidate.reason
      };
    } catch (error) {
      console.error(`❌ 자동 앵커 이동 실패 (${agentId}/${slot}):`, error);
      throw error;
    }
  }

  /**
   * 검색 후 자동 앵커 이동 체크 (선택적)
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯
   * @param queryEmbedding - 검색 쿼리 임베딩
   * @param autoMoveEnabled - 자동 이동 활성화 여부 (기본값: false)
   * @returns 이동 결과
   */
  async checkAndAutoReanchor(
    agentId: string,
    slot: AnchorSlot,
    queryEmbedding?: number[],
    autoMoveEnabled: boolean = false
  ): Promise<{
    moved: boolean;
    old_anchor: string | null;
    new_anchor: string | null;
    score: number;
    reason: string;
  } | null> {
    if (!autoMoveEnabled) {
      return null;
    }

    try {
      return await this.autoReanchor(agentId, slot, queryEmbedding, 0.7, 'gradual');
    } catch (error) {
      console.error(`❌ 자동 앵커 이동 체크 실패:`, error);
      return null;
    }
  }
}

