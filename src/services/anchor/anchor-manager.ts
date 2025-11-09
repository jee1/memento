/**
 * Anchor Manager
 * 핵심 앵커 관리 (CRUD) 담당
 * Phase 1.1: anchor-manager.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { IAnchorManager, IAnchorCacheService, IAnchorSearchService, AnchorSlot, AnchorInfo } from './anchor-interfaces.js';
import { AnchorError, MemoryNotFoundError } from './anchor-interfaces.js';
import { logger } from '../../utils/logger.js';

/**
 * Anchor Manager 구현
 * 단일 책임 원칙: 앵커 CRUD 작업만 담당
 */
export class AnchorManager implements IAnchorManager {
  private db: Database.Database | null = null;
  private cacheService: IAnchorCacheService;
  private searchService: IAnchorSearchService;

  /**
   * 슬롯별 설정
   */
  private readonly slotConfig = {
    A: { hop_limit: 1, vector_threshold: 0.8 },
    B: { hop_limit: 2, vector_threshold: 0.6 },
    C: { hop_limit: 3, vector_threshold: 0.4 }
  } as const;

  /**
   * 생성자
   * 의존성 주입을 통해 캐시 서비스와 검색 서비스를 받음
   */
  constructor(
    cacheService: IAnchorCacheService,
    searchService: IAnchorSearchService
  ) {
    this.cacheService = cacheService;
    this.searchService = searchService;
    logger.info('AnchorManager 초기화 완료');
  }

  /**
   * 데이터베이스 설정
   */
  setDatabase(db: Database.Database): void {
    if (!db) {
      throw new Error('Database instance is required');
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
      throw new Error('Database is not set. Call setDatabase() first.');
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
      throw new Error('Database is not set. Call setDatabase() first.');
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
   * 검색 서비스 접근 (하위 호환성을 위해 유지)
   * @deprecated 직접 searchService를 사용하세요
   */
  getSearchService(): IAnchorSearchService {
    return this.searchService;
  }

  /**
   * 캐시 서비스 접근 (하위 호환성을 위해 유지)
   * @deprecated 직접 cacheService를 사용하세요
   */
  getCacheService(): IAnchorCacheService {
    return this.cacheService;
  }
}

