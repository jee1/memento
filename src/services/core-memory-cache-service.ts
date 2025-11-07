/**
 * Core Memory Cache Service
 * always_load=true인 Core Memory 항목들을 메모리에 캐싱
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: Core Memory 캐싱만 담당
 * - TTL 없음: always_load=true인 항목은 영구적으로 메모리에 유지
 * - 빠른 조회: Map 기반 O(1) 조회 성능
 */

import type { CoreMemoryRecord } from '../repositories/core-memory-repository.js';
import type { CoreMemoryCache } from './core-memory-service.js';

/**
 * Core Memory Cache Service Implementation
 * always_load=true인 Core Memory 항목들을 메모리에 캐싱
 */
export class CoreMemoryCacheService implements CoreMemoryCache {
  private cache: Map<string, CoreMemoryRecord> = new Map();

  /**
   * 항목을 캐시에 저장
   */
  set(key: string, value: CoreMemoryRecord): void {
    this.cache.set(key, value);
  }

  /**
   * 캐시에서 항목 조회
   */
  get(key: string): CoreMemoryRecord | undefined {
    return this.cache.get(key);
  }

  /**
   * 캐시에서 항목 삭제
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 캐시 전체 조회 (always_load=true인 항목들)
   */
  getAll(): CoreMemoryRecord[] {
    return Array.from(this.cache.values());
  }

  /**
   * 캐시 무효화
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 캐시에 항목이 있는지 확인
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 캐시 크기 반환
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 캐시 키 목록 반환
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * agent_id로 필터링된 항목 조회
   */
  getByAgentId(agent_id: string): CoreMemoryRecord[] {
    return Array.from(this.cache.values()).filter(
      record => record.agent_id === agent_id
    );
  }

  /**
   * agent_id로 필터링된 항목 삭제
   */
  deleteByAgentId(agent_id: string): number {
    let deletedCount = 0;
    for (const [key, record] of this.cache.entries()) {
      if (record.agent_id === agent_id) {
        this.cache.delete(key);
        deletedCount++;
      }
    }
    return deletedCount;
  }

  /**
   * 캐시 통계 반환
   */
  getStats(): {
    size: number;
    agentIds: string[];
    keys: string[];
  } {
    const agentIds = new Set<string>();
    for (const record of this.cache.values()) {
      agentIds.add(record.agent_id);
    }

    return {
      size: this.cache.size,
      agentIds: Array.from(agentIds),
      keys: Array.from(this.cache.keys())
    };
  }
}

