/**
 * Anchor Manager Service (하위 호환성 래퍼)
 * 새로운 구조로 리팩토링된 서비스들을 통합하여 기존 인터페이스 유지
 * Phase 1.1: anchor-manager.ts 리팩토링
 * 
 * @deprecated 새로운 구조에서는 src/services/anchor/ 디렉토리의 서비스들을 직접 사용하세요
 */

import type Database from 'better-sqlite3';
import type { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import type { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import { getVectorSearchEngine } from '../domains/search/algorithms/vector-search-engine.js';
import type { VectorSearchEngine } from '../domains/search/algorithms/vector-search-engine.js';
import { AnchorManager as NewAnchorManager } from '../domains/anchor/services/anchor/anchor-manager.js';
import { AnchorCacheService } from '../domains/anchor/services/anchor/anchor-cache-service.js';
import { AnchorSearchService } from '../domains/anchor/services/anchor/anchor-search-service.js';
import type { AnchorSlot, AnchorInfo, SearchOptions, SearchResult } from '../domains/anchor/services/anchor/anchor-interfaces.js';
import { AnchorError, MemoryNotFoundError } from '../domains/anchor/services/anchor/anchor-interfaces.js';
import { logger } from '../shared/utils/logger.js';

// 기존 타입 및 인터페이스 export (하위 호환성)
export type { AnchorSlot, AnchorInfo, SearchOptions, SearchResult };
export { AnchorError, MemoryNotFoundError };

/**
 * Anchor Manager Service (하위 호환성 래퍼)
 * 기존 인터페이스를 유지하면서 새로운 구조의 서비스들을 사용
 */
export class AnchorManager {
  private newAnchorManager: NewAnchorManager;
  private cacheService: AnchorCacheService;
  private searchService: AnchorSearchService;
  private db: Database.Database | null = null;
  private embeddingService: MemoryEmbeddingService | null = null;
  private hybridSearchEngine: HybridSearchEngine | null = null;
  private vectorSearchEngine: ReturnType<typeof getVectorSearchEngine> | null = null;

  /**
   * 생성자
   */
  constructor() {
    // 새로운 구조의 서비스들 초기화
    this.cacheService = new AnchorCacheService();
    this.searchService = new AnchorSearchService(this.cacheService);
    this.newAnchorManager = new NewAnchorManager(this.cacheService, this.searchService);
    logger.info('AnchorManager 서비스 초기화 완료 (하위 호환성 래퍼)');
  }

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database): void {
    if (!db) {
      throw new Error('Database instance is required');
    }
    this.db = db;
    this.newAnchorManager.setDatabase(db);
    this.cacheService.setDatabase(db);
    this.searchService.setDatabase(db);
    
    // VectorSearchEngine이 설정되어 있으면 초기화
    if (this.vectorSearchEngine) {
      this.vectorSearchEngine.initialize(db);
    }
  }

  /**
   * 임베딩 서비스 설정
   */
  setEmbeddingService(embeddingService: MemoryEmbeddingService): void {
    if (!embeddingService) {
      throw new Error('MemoryEmbeddingService is required');
    }
    this.embeddingService = embeddingService;
    this.cacheService.setEmbeddingService(embeddingService);
  }

  /**
   * 하이브리드 검색 엔진 설정
   */
  setHybridSearchEngine(hybridSearchEngine: HybridSearchEngine): void {
    if (!hybridSearchEngine) {
      throw new Error('HybridSearchEngine is required');
    }
    this.hybridSearchEngine = hybridSearchEngine;
    this.searchService.setHybridSearchEngine(hybridSearchEngine);
  }

  /**
   * 벡터 검색 엔진 설정
   */
  setVectorSearchEngine(vectorSearchEngine: ReturnType<typeof getVectorSearchEngine>): void {
    if (!vectorSearchEngine) {
      throw new Error('VectorSearchEngine is required');
    }
    this.vectorSearchEngine = vectorSearchEngine;
    this.searchService.setVectorSearchEngine(vectorSearchEngine);
    // 데이터베이스가 이미 설정되어 있으면 초기화
    if (this.db) {
      this.vectorSearchEngine.initialize(this.db);
    }
  }

  /**
   * 앵커 설정
   */
  async setAnchor(agentId: string, memoryId: string, slot: AnchorSlot): Promise<void> {
    return this.newAnchorManager.setAnchor(agentId, memoryId, slot);
  }

  /**
   * 앵커 조회
   */
  async getAnchor(agentId: string, slot?: AnchorSlot): Promise<AnchorInfo | AnchorInfo[] | null> {
    return this.newAnchorManager.getAnchor(agentId, slot);
  }

  /**
   * 앵커 제거
   */
  async clearAnchor(agentId: string, slot?: AnchorSlot): Promise<void> {
    return this.newAnchorManager.clearAnchor(agentId, slot);
  }

  /**
   * 국소 검색
   */
  async searchLocal(
    agentId: string,
    slot: AnchorSlot,
    query?: string,
    hopLimit?: number,
    options?: SearchOptions
  ): Promise<SearchResult> {
    if (!this.db) {
      throw new Error('Database is not set. Call setDatabase() first.');
    }

    if (!this.embeddingService) {
      throw new Error('MemoryEmbeddingService is not set. Call setEmbeddingService() first.');
    }

    const startTime = Date.now();

    // 앵커 조회
    const anchor = await this.getAnchor(agentId, slot);
    if (!anchor || Array.isArray(anchor) || !anchor.memory_id) {
      logger.warn('No anchor set for agent', { agentId, slot });
      
      if (!query) {
        throw new AnchorError(
          `No anchor set for agent '${agentId}' in slot '${slot}'. ` +
          `Anchor is required for anchor-based recall. ` +
          `If the anchor memory was deleted, please set a new anchor.`
        );
      }
      // query가 있으면 전역 검색으로 fallback
      logger.info('Anchor missing, falling back to global search', { query });
      return await this.searchService.fallbackToGlobalSearch(query, options, startTime);
    }

    // 슬롯별 설정 가져오기
    const slotConfig = this.newAnchorManager.getSlotConfig(slot);
    const finalHopLimit = hopLimit ?? slotConfig.hop_limit;

    // 앵커 메모리 임베딩 조회
    let anchorEmbedding = await this.cacheService.getAnchorEmbedding(anchor.memory_id);
    if (!anchorEmbedding) {
      // 임베딩이 없으면 메모리 존재 확인 후 생성 시도
      const memory = this.db.prepare(`
        SELECT id, content, type FROM memory_item WHERE id = ?
      `).get(anchor.memory_id) as { id: string; content: string; type: string } | undefined;

      if (!memory) {
        logger.warn('Anchor memory not found (may have been deleted)', { memoryId: anchor.memory_id });
        
        // 앵커를 자동으로 정리
        try {
          await this.clearAnchor(agentId, slot);
          logger.info('Cleared invalid anchor', { agentId, slot });
        } catch (error) {
          logger.error('Failed to clear invalid anchor', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
        // query가 있으면 전역 검색으로 fallback
        if (query) {
          logger.info('Anchor memory deleted, falling back to global search', { query });
          return await this.searchService.fallbackToGlobalSearch(query, options, startTime);
        }
        
        // query가 없으면 에러 반환
        throw new MemoryNotFoundError(
          anchor.memory_id + 
          ` (Memory may have been deleted. Please set a new anchor.)`
        );
      }

      // Edge Case: 임베딩 없음 - 생성 시도
      logger.info('Generating embedding for anchor memory', { memoryId: anchor.memory_id });
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
      const newEmbedding = await this.cacheService.getAnchorEmbedding(anchor.memory_id);
      if (!newEmbedding) {
        throw new Error(
          `Failed to retrieve newly created embedding for '${anchor.memory_id}'. ` +
          `Please try again or check the database.`
        );
      }

      anchorEmbedding = newEmbedding;
      logger.info('Embedding generated and retrieved for anchor memory', { memoryId: anchor.memory_id });
    }

    // VectorSearchEngine이 없으면 생성
    if (!this.vectorSearchEngine) {
      this.vectorSearchEngine = getVectorSearchEngine();
      if (this.db) {
        this.vectorSearchEngine.initialize(this.db);
      }
      this.searchService.setVectorSearchEngine(this.vectorSearchEngine);
    }

    // 검색 실행
    const searchResult = await this.searchService.searchLocal(
      agentId,
      slot,
      query,
      finalHopLimit,
      options,
      anchor.memory_id,
      anchorEmbedding,
      startTime
    );

    // 자동 앵커 이동 체크 (query가 있고 queryEmbeddingForReanchor가 생성된 경우)
    if (query && options?.autoMoveEnabled !== false) {
      try {
        // 쿼리 임베딩 생성
        const { UnifiedEmbeddingService } = await import('../domains/embedding/services/unified-embedding-service.js');
        const queryEmbeddingService = new UnifiedEmbeddingService();
        const queryEmbeddingResult = await queryEmbeddingService.generateEmbedding(query);
        
        if (queryEmbeddingResult && queryEmbeddingResult.embedding) {
          await this.searchService.checkAndAutoReanchor(
            agentId,
            slot,
            this.newAnchorManager,
            queryEmbeddingResult.embedding,
            true
          );
        }
      } catch (error) {
        // 자동 앵커 이동 실패는 검색 결과에 영향을 주지 않음
        logger.debug('Auto anchor move check failed (ignored)', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return searchResult;
  }

  /**
   * 앵커 메모리의 임베딩 조회
   */
  private async getAnchorEmbedding(memoryId: string): Promise<{ embedding: number[]; provider: string } | null> {
    return this.cacheService.getAnchorEmbedding(memoryId);
  }

  /**
   * 서버 재시작 시 DB에서 캐시 복원
   */
  async restoreCacheFromDB(db: Database.Database): Promise<void> {
    return this.cacheService.restoreCacheFromDB(db);
  }

  /**
   * 슬롯별 설정 조회
   */
  getSlotConfig(slot: AnchorSlot): { hop_limit: number; vector_threshold: number } {
    return this.newAnchorManager.getSlotConfig(slot);
  }

  /**
   * 자동 앵커 이동 실행
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
    return this.searchService.autoReanchor(
      agentId,
      slot,
      this.newAnchorManager,
      queryEmbedding,
      threshold,
      strategy
    );
  }

  /**
   * 앵커 주변 메모리 사용 패턴 분석
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

    const anchorEmbedding = await this.cacheService.getAnchorEmbedding(anchor.memory_id);
    if (!anchorEmbedding) {
      return [];
    }

    return this.searchService.analyzeAnchorUsage(
      agentId,
      slot,
      anchor.memory_id,
      anchorEmbedding,
      queryEmbedding
    );
  }

  /**
   * 검색 후 자동 앵커 이동 체크
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
    return this.searchService.checkAndAutoReanchor(
      agentId,
      slot,
      this.newAnchorManager,
      queryEmbedding,
      autoMoveEnabled
    );
  }
}
