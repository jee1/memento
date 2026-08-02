/**
 * Anchor Manager
 * 핵심 앵커 관리 (CRUD) 담당
 * Phase 1.1: anchor-manager.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { IAnchorManager, IAnchorCacheService, IAnchorSearchService, AnchorSlot, AnchorInfo, SearchOptions, SearchResult } from './anchor-interfaces.js';
import { AnchorError, MemoryNotFoundError, DatabaseValidationError, AnchorNotFoundError } from './anchor-interfaces.js';
import { logger } from '../../../../shared/utils/logger.js';
import { ErrorLoggingService, ErrorSeverity, ErrorCategory } from '../../../../domains/monitoring/services/error-logging-service.js';

/**
 * Anchor Manager 구현
 * 단일 책임 원칙: 앵커 CRUD 작업만 담당
 */
export class AnchorManager implements IAnchorManager {
  private db: Database.Database | null = null;
  private cacheService: IAnchorCacheService;
  private searchService: IAnchorSearchService;
  private errorLoggingService: ErrorLoggingService | null = null;

  /**
   * 슬롯별 설정
   */
  private readonly slotConfig = {
    A: { hop_limit: 1, vector_threshold: 0.8 },
    B: { hop_limit: 2, vector_threshold: 0.6 },
    C: { hop_limit: 3, vector_threshold: 0.4 }
  } as const;

  /**
   * 생성자 (옵션으로 db·errorLoggingService 주입 시 일괄 설정, 미전달 시 setDatabase/setErrorLoggingService 호출 필요)
   */
  constructor(
    cacheService: IAnchorCacheService,
    searchService: IAnchorSearchService,
    options?: { db?: Database.Database; errorLoggingService?: ErrorLoggingService }
  ) {
    this.cacheService = cacheService;
    this.searchService = searchService;
    if (options?.db) this.setDatabase(options.db);
    if (options?.errorLoggingService) this.setErrorLoggingService(options.errorLoggingService);
    logger.info('AnchorManager 초기화 완료');
  }

  /**
   * ErrorLoggingService 설정 (Phase 8.3)
   * 에러 로깅 서비스를 주입하여 구조화된 에러 로깅 활성화
   */
  setErrorLoggingService(errorLoggingService: ErrorLoggingService): void {
    this.errorLoggingService = errorLoggingService;
  }

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database): void {
    if (!db) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('Database instance is required');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorManager',
            operation: 'setDatabase'
          }
        );
      }
      throw error;
    }
    this.db = db;
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
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('Database is not set. Call setDatabase() first.');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorManager',
            operation: 'setAnchor',
            agentId,
            memoryId,
            slot
          }
        );
      }
      throw error;
    }

    // 메모리 존재 확인
    const memory = this.db.prepare(`
      SELECT id FROM memory_item WHERE id = ?
    `).get(memoryId) as { id: string } | undefined;

    if (!memory) {
      const error = new MemoryNotFoundError(memoryId);
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.MEMORY,
          {
            component: 'AnchorManager',
            operation: 'setAnchor',
            agentId,
            memoryId,
            slot
          }
        );
      }
      throw error;
    }

    // 동일한 agent_id가 동일한 memory_id를 다른 슬롯에 이미 설정했는지 확인
    const existingAnchor = this.db.prepare(`
      SELECT slot FROM anchor 
      WHERE agent_id = ? AND memory_id = ? AND slot != ?
    `).get(agentId, memoryId, slot) as { slot: string } | undefined;

    if (existingAnchor) {
      // Phase 8.4: 커스텀 에러 클래스 사용 및 ErrorLoggingService를 통한 에러 로깅
      const error = new AnchorError(
        `Memory '${memoryId}' is already set as anchor in slot '${existingAnchor.slot}'. ` +
        `An agent cannot set the same memory in multiple slots.`
      );
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorManager',
            operation: 'setAnchor',
            agentId,
            memoryId,
            slot,
            existingSlot: existingAnchor.slot
          }
        );
      }
      throw error;
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
    this.cacheService.updateCache(agentId, slot, memoryId);
  }

  /**
   * 앵커 조회
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯 (A, B, C), 선택적. 없으면 모든 슬롯 반환
   * @returns 앵커 정보 또는 null
   */
  async getAnchor(agentId: string, slot?: AnchorSlot): Promise<AnchorInfo | AnchorInfo[] | null> {
    if (!this.db) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('Database is not set. Call setDatabase() first.');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorManager',
            operation: 'getAnchor',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    // 캐시에서 먼저 확인
    const cached = this.cacheService.getCachedAnchor(agentId);
    
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
        this.cacheService.updateCache(agentId, slot, anchor.memory_id);
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
        this.cacheService.updateCache(anchor.agent_id, anchor.slot, anchor.memory_id);
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
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('Database is not set. Call setDatabase() first.');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorManager',
            operation: 'clearAnchor',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    if (slot) {
      // 특정 슬롯 제거
      this.db.prepare(`
        DELETE FROM anchor WHERE agent_id = ? AND slot = ?
      `).run(agentId, slot);

      // 캐시 업데이트
      this.cacheService.updateCache(agentId, slot, null);
    } else {
      // 모든 슬롯 제거
      this.db.prepare(`
        DELETE FROM anchor WHERE agent_id = ?
      `).run(agentId);

      // 캐시에서 제거
      this.cacheService.deleteCache(agentId);
    }
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
   * DB에서 캐시 복원
   * @param db - 데이터베이스 인스턴스
   */
  async restoreCacheFromDB(db: Database.Database): Promise<void> {
    return this.cacheService.restoreCacheFromDB(db);
  }

  /**
   * 국소 검색 수행
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯 (A, B, C)
   * @param query - 검색 쿼리 (선택적)
   * @param hopLimit - hop 제한 (선택적)
   * @param options - 검색 옵션
   */
  async searchLocal(
    agentId: string,
    slot: AnchorSlot,
    query?: string,
    hopLimit?: number,
    options?: SearchOptions
  ): Promise<SearchResult> {
    if (!this.db) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError('Database is not set. Call setDatabase() first.');
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.VALIDATION,
          {
            component: 'AnchorManager',
            operation: 'searchLocal',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    // 앵커 정보 가져오기
    const anchorInfo = await this.getAnchor(agentId, slot);
    if (!anchorInfo) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new AnchorNotFoundError(agentId, slot);
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.MEMORY,
          {
            component: 'AnchorManager',
            operation: 'searchLocal',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    const anchorMemoryId = Array.isArray(anchorInfo) ? anchorInfo[0]?.memory_id : anchorInfo.memory_id;
    if (!anchorMemoryId) {
      // Phase 8.4: 커스텀 에러 클래스 사용
      const error = new DatabaseValidationError(`Anchor memory_id is null for agent_id: ${agentId}, slot: ${slot}`);
      // Phase 8.3: ErrorLoggingService를 통한 에러 로깅
      if (this.errorLoggingService) {
        this.errorLoggingService.logError(
          error,
          ErrorSeverity.MEDIUM,
          ErrorCategory.MEMORY,
          {
            component: 'AnchorManager',
            operation: 'searchLocal',
            agentId,
            slot
          }
        );
      }
      throw error;
    }

    // 앵커 임베딩 가져오기
    const anchorEmbedding = await this.cacheService.getAnchorEmbedding(anchorMemoryId);

    const startTime = Date.now();
    return this.searchService.searchLocal(
      agentId,
      slot,
      query,
      hopLimit,
      options,
      anchorMemoryId,
      anchorEmbedding,
      startTime
    );
  }
}
