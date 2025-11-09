/**
 * Anchor 서비스 인터페이스 정의
 * 순환 의존성 방지를 위한 인터페이스 기반 설계
 * Phase 1.1: anchor-manager.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { MemoryEmbeddingService } from '../memory-embedding-service.js';
import type { HybridSearchEngine } from '../../algorithms/hybrid-search-engine.js';
import type { VectorSearchEngine } from '../../algorithms/vector-search-engine.js';

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
  autoMoveEnabled?: boolean;
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
    importance?: number;
    created_at?: string;
    tags?: string[] | undefined;
    [key: string]: unknown;
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
 * 앵커 캐시 서비스 인터페이스
 * 캐시 및 임베딩 관리 담당
 */
export interface IAnchorCacheService {
  /**
   * 앵커 메모리의 임베딩 조회
   */
  getAnchorEmbedding(memoryId: string): Promise<{ embedding: number[]; provider: string } | null>;

  /**
   * 서버 재시작 시 DB에서 캐시 복원
   */
  restoreCacheFromDB(db: Database.Database): Promise<void>;

  /**
   * 캐시 업데이트
   */
  updateCache(agentId: string, slot: AnchorSlot, memoryId: string | null): void;

  /**
   * 캐시에서 앵커 조회
   */
  getCachedAnchor(agentId: string, slot?: AnchorSlot): { A: string | null; B: string | null; C: string | null } | undefined;

  /**
   * 캐시 삭제
   */
  deleteCache(agentId: string): void;
}

/**
 * 앵커 검색 서비스 인터페이스
 * 검색 관련 로직 담당
 */
export interface IAnchorSearchService {
  /**
   * 국소 검색
   */
  searchLocal(
    agentId: string,
    slot: AnchorSlot,
    query: string | undefined,
    hopLimit: number | undefined,
    options: SearchOptions | undefined,
    anchorMemoryId: string,
    anchorEmbedding: { embedding: number[]; provider: string },
    startTime: number
  ): Promise<SearchResult>;

  /**
   * 전역 검색으로 Fallback
   */
  fallbackToGlobalSearch(
    query: string,
    options: SearchOptions | undefined,
    startTime: number | undefined
  ): Promise<SearchResult>;
}

/**
 * 앵커 관리자 인터페이스
 * 핵심 앵커 관리 (CRUD) 담당
 */
export interface IAnchorManager {
  /**
   * 앵커 설정
   */
  setAnchor(agentId: string, memoryId: string, slot: AnchorSlot): Promise<void>;

  /**
   * 앵커 조회
   */
  getAnchor(agentId: string, slot?: AnchorSlot): Promise<AnchorInfo | AnchorInfo[] | null>;

  /**
   * 앵커 제거
   */
  clearAnchor(agentId: string, slot?: AnchorSlot): Promise<void>;

  /**
   * 슬롯별 설정 조회
   */
  getSlotConfig(slot: AnchorSlot): { hop_limit: number; vector_threshold: number };
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

