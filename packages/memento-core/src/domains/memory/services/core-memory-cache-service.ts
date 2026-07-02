/**
 * Core Memory Cache Service
 * always_load=true인 Core Memory 항목들을 메모리에 캐싱
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: Core Memory 캐싱만 담당
 * - TTL 없음: always_load=true인 항목은 영구적으로 메모리에 유지
 * - 빠른 조회: Map 기반 O(1) 조회 성능
 */

import type { CoreMemoryRecord } from '../repositories/core-memory-repository.interface.js';
import type { CoreMemoryCache } from './core-memory-service.js';
import { logger } from '../../../shared/utils/logger.js';

/**
 * 캐시 엔트리 인터페이스
 * 버전 정보와 캐시 시간을 포함합니다.
 */
export interface CacheEntry {
  record: CoreMemoryRecord;
  cachedAt: number; // 캐시된 시간 (timestamp)
  version: number; // 레코드의 버전 번호
}

/**
 * 캐시 무효화 리스너 인터페이스
 */
export interface CacheInvalidationListener {
  /**
   * 특정 키의 캐시가 무효화될 때 호출됨
   */
  onInvalidate(key: string, reason?: string): void;

  /**
   * 전체 캐시가 무효화될 때 호출됨
   */
  onInvalidateAll(reason?: string): void;
}

/**
 * Core Memory Cache Service Implementation
 * always_load=true인 Core Memory 항목들을 메모리에 캐싱
 * 버전 기반 캐시 무효화 지원
 */
export class CoreMemoryCacheService implements CoreMemoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private listeners: Set<CacheInvalidationListener> = new Set();

  /**
   * 항목을 캐시에 저장
   * version=0인 경우 경고 로그 출력 (마이그레이션 미완료 가능성)
   */
  set(key: string, value: CoreMemoryRecord): void {
    // version=0인 경우 경고 로그 출력
    if (value.version === 0) {
      logger.warn(`CoreMemoryCacheService: version=0인 항목이 캐시에 저장됨 (key: ${key}). 마이그레이션이 완료되지 않았을 수 있습니다.`);
    }

    const entry: CacheEntry = {
      record: value,
      cachedAt: Date.now(),
      version: value.version
    };
    this.cache.set(key, entry);
  }

  /**
   * 캐시에서 항목 조회
   */
  get(key: string): CoreMemoryRecord | undefined {
    const entry = this.cache.get(key);
    return entry ? entry.record : undefined;
  }

  /**
   * 캐시에서 항목과 버전 정보 조회
   */
  getWithVersion(key: string): CacheEntry | undefined {
    return this.cache.get(key);
  }

  /**
   * 캐시에서 항목 삭제
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      // 리스너에게 알림
      this.notifyInvalidate(key, 'delete');
    }
    return deleted;
  }

  /**
   * 버전 기반 캐시 무효화
   * DB의 버전이 캐시의 버전보다 높으면 무효화
   * version=0인 경우 항상 무효화 (마이그레이션 미완료로 간주)
   */
  invalidateByVersion(key: string, dbVersion: number): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false; // 캐시에 없음
    }

    // version=0인 경우 항상 무효화
    if (entry.version === 0) {
      this.cache.delete(key);
      this.notifyInvalidate(key, 'version_zero');
      return true;
    }

    // DB 버전이 캐시 버전보다 높으면 무효화
    if (dbVersion > entry.version) {
      this.cache.delete(key);
      this.notifyInvalidate(key, `version_mismatch: cache=${entry.version}, db=${dbVersion}`);
      return true;
    }

    return false; // 무효화되지 않음
  }

  /**
   * 캐시 무효화 리스너 구독
   */
  subscribeInvalidation(listener: CacheInvalidationListener): void {
    this.listeners.add(listener);
  }

  /**
   * 캐시 무효화 리스너 구독 해제
   */
  unsubscribeInvalidation(listener: CacheInvalidationListener): void {
    this.listeners.delete(listener);
  }

  /**
   * 특정 키 무효화 알림
   */
  private notifyInvalidate(key: string, reason?: string): void {
    for (const listener of this.listeners) {
      try {
        listener.onInvalidate(key, reason);
      } catch (error) {
        logger.error(`CacheInvalidationListener.onInvalidate 오류: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * 전체 캐시 무효화 알림
   */
  private notifyInvalidateAll(reason?: string): void {
    for (const listener of this.listeners) {
      try {
        listener.onInvalidateAll(reason);
      } catch (error) {
        logger.error(`CacheInvalidationListener.onInvalidateAll 오류: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * 캐시 전체 조회 (always_load=true인 항목들)
   */
  getAll(): CoreMemoryRecord[] {
    return Array.from(this.cache.values()).map(entry => entry.record);
  }

  /**
   * 캐시 무효화
   */
  clear(): void {
    this.cache.clear();
    // 리스너에게 알림
    this.notifyInvalidateAll('clear');
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
    return Array.from(this.cache.values())
      .filter(entry => entry.record.agent_id === agent_id)
      .map(entry => entry.record);
  }

  /**
   * agent_id로 필터링된 항목 삭제
   */
  deleteByAgentId(agent_id: string): number {
    let deletedCount = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.record.agent_id === agent_id) {
        this.cache.delete(key);
        this.notifyInvalidate(key, `deleteByAgentId: ${agent_id}`);
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
    for (const entry of this.cache.values()) {
      agentIds.add(entry.record.agent_id);
    }

    return {
      size: this.cache.size,
      agentIds: Array.from(agentIds),
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * 캐시 무효화 (별칭, 리스너 알림 포함)
   */
  invalidate(key: string, reason?: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.notifyInvalidate(key, reason);
    }
    return deleted;
  }
}

// 싱글톤 인스턴스
let cacheInstance: CoreMemoryCacheService | null = null;

/**
 * 전역 Core Memory Cache 인스턴스 가져오기
 * 서버 초기화 시 생성된 캐시를 공유합니다.
 */
export function getCoreMemoryCache(): CoreMemoryCacheService {
  if (!cacheInstance) {
    cacheInstance = new CoreMemoryCacheService();
  }
  return cacheInstance;
}

/**
 * Core Memory Cache 인스턴스 설정 (초기화 시 사용)
 */
export function setCoreMemoryCache(cache: CoreMemoryCacheService): void {
  cacheInstance = cache;
}

/**
 * Core Memory Cache 인스턴스 초기화 (테스트용)
 */
export function resetCoreMemoryCache(): void {
  cacheInstance = null;
}

