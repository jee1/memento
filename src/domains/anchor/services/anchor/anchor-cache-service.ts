/**
 * Anchor Cache Service
 * 캐시 및 임베딩 관리 담당
 * Phase 1.1: anchor-manager.ts 리팩토링
 */

import type Database from 'better-sqlite3';
import type { MemoryEmbeddingService } from '../../../memory/services/memory-embedding-service.js';
import type { IAnchorCacheService, AnchorSlot } from './anchor-interfaces.js';
import { logger } from '../../../../shared/utils/logger.js';

/**
 * Anchor Cache Service 구현
 */
export class AnchorCacheService implements IAnchorCacheService {
  /**
   * 메모리 캐시: agent_id별 슬롯 상태 관리
   * Map<agent_id, {A: memory_id | null, B: memory_id | null, C: memory_id | null}>
   */
  private cache: Map<string, { A: string | null; B: string | null; C: string | null }> = new Map();

  private db: Database.Database | null = null;
  private embeddingService: MemoryEmbeddingService | null = null;

  /**
   * 생성자
   */
  constructor() {
    logger.info('AnchorCacheService 초기화 완료');
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
   * 임베딩 서비스 설정
   */
  setEmbeddingService(embeddingService: MemoryEmbeddingService): void {
    if (!embeddingService) {
      throw new Error('MemoryEmbeddingService is required');
    }
    this.embeddingService = embeddingService;
  }

  /**
   * 앵커 메모리의 임베딩 조회
   * @param memoryId - 메모리 ID
   * @returns 임베딩 벡터 및 제공자 정보, 없으면 null
   */
  async getAnchorEmbedding(memoryId: string): Promise<{ embedding: number[]; provider: string } | null> {
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
        logger.warn('Memory not found (may have been deleted)', { memoryId });
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
          logger.warn('Invalid embedding (empty or not an array)', { memoryId });
          return null;
        }
      } catch (error) {
        // Edge Case: 임베딩 파싱 실패
        logger.error('Embedding parsing failed', { memoryId, error: error instanceof Error ? error.message : String(error) });
        return null;
      }

      const provider = embeddingRecord.embedding_provider || 'tfidf';

      return {
        embedding: embeddingVector,
        provider: provider
      };
    } catch (error) {
      // Edge Case: 데이터베이스 오류
      logger.error('Embedding retrieval failed', { memoryId, error: error instanceof Error ? error.message : String(error) });
      return null;
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
        logger.warn('Anchor table does not exist yet, starting with empty cache');
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

      logger.info('Anchor cache restored', { agentCount: this.cache.size });
    } catch (error) {
      // 에러 발생 시 빈 캐시로 시작 (테이블이 없거나 다른 문제)
      this.cache.clear();
      logger.warn('Failed to restore anchor cache from DB, starting with empty cache', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 캐시 업데이트 헬퍼 메서드
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯
   * @param memoryId - 메모리 ID (null이면 제거)
   */
  updateCache(agentId: string, slot: AnchorSlot, memoryId: string | null): void {
    if (!this.cache.has(agentId)) {
      this.cache.set(agentId, { A: null, B: null, C: null });
    }

    const agentCache = this.cache.get(agentId)!;
    agentCache[slot] = memoryId;
  }

  /**
   * 캐시에서 앵커 조회
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯 (선택적)
   * @returns 캐시된 앵커 정보
   */
  getCachedAnchor(agentId: string, slot?: AnchorSlot): { A: string | null; B: string | null; C: string | null } | undefined {
    return this.cache.get(agentId);
  }

  /**
   * 캐시에서 특정 슬롯의 메모리 ID 조회
   * @param agentId - 에이전트 ID
   * @param slot - 슬롯
   * @returns 메모리 ID 또는 undefined
   */
  getCachedMemoryId(agentId: string, slot: AnchorSlot): string | null | undefined {
    const cached = this.cache.get(agentId);
    return cached?.[slot];
  }

  /**
   * 캐시 삭제
   * @param agentId - 에이전트 ID
   */
  deleteCache(agentId: string): void {
    this.cache.delete(agentId);
  }
}

