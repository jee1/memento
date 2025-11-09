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
   * 국소 검색 (searchLocal 메서드는 작업 3.0에서 구현)
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
    // 작업 3.0에서 구현 예정
    throw new Error('searchLocal method will be implemented in task 3.0');
  }

  /**
   * 서버 재시작 시 DB에서 캐시 복원
   * @param db - 데이터베이스 인스턴스
   */
  async restoreCacheFromDB(db: Database.Database): Promise<void> {
    if (!db) {
      throw new Error('Database instance is required');
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
}

