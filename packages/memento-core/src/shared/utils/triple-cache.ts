/**
 * Triple 추출 결과 캐시 서비스
 * 
 * PRD 7.3: 캐싱 (TTL 조정 및 설정 가능)
 * - 동일한 content에 대한 Triple 추출 결과 캐싱
 * - 캐시 키: content의 해시값 (content_hash)
 * - 캐싱 TTL: 6시간 (기본값, 설정 가능)
 * - 캐시 크기: 100개 항목 (설정 가능)
 * - LRU 캐시 활용
 */

import { CacheService } from '../../infrastructure/cache/cache-service.js';
import type { TripleExtractionResult } from '../types/triple-extraction.js';
import { createHash } from 'crypto';

/**
 * Triple 추출 결과 캐시 서비스
 */
export class TripleCacheService {
  private cache: CacheService<TripleExtractionResult>;
  private readonly defaultTTL: number;
  private readonly maxSize: number;

  /**
   * @param maxSize 최대 캐시 크기 (기본값: 100)
   * @param ttl TTL (밀리초, 기본값: 6시간)
   */
  constructor(maxSize: number = 100, ttl: number = 6 * 60 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultTTL = ttl;
    this.cache = new CacheService<TripleExtractionResult>(maxSize, ttl);
  }

  /**
   * 캐시 키 생성 (content_hash 기반)
   * 
   * PRD 6.12: 캐시 키 생성 로직 구현
   * - content의 해시값을 사용하여 캐시 키 생성
   * - SHA-256 해시 사용 (충돌 방지)
   * 
   * @param content Episodic Memory의 content (observation 텍스트)
   * @returns 캐시 키
   */
  generateCacheKey(content: string): string {
    // PRD 6.12: content_hash 기반 캐시 키 생성
    // SHA-256 해시 사용하여 충돌 방지
    const hash = createHash('sha256');
    hash.update(content);
    return `triple:${hash.digest('hex')}`;
  }

  /**
   * 캐시에서 Triple 추출 결과 가져오기
   * 
   * PRD 6.14: TripleExtractionService에 캐싱 통합
   * - 캐시 히트 시 LLM 호출 생략
   * 
   * @param content Episodic Memory의 content
   * @returns Triple 추출 결과 또는 null (캐시 미스)
   */
  get(content: string): TripleExtractionResult | null {
    const cacheKey = this.generateCacheKey(content);
    return this.cache.get(cacheKey);
  }

  /**
   * 캐시에 Triple 추출 결과 저장
   * 
   * PRD 6.14: TripleExtractionService에 캐싱 통합
   * - 성공한 Triple 추출 결과만 캐시에 저장
   * 
   * @param content Episodic Memory의 content
   * @param result Triple 추출 결과
   * @param ttl TTL (밀리초, 선택사항, 기본값 사용)
   */
  set(content: string, result: TripleExtractionResult, ttl?: number): void {
    // PRD 7.3: 성공한 Triple 추출 결과만 캐시에 저장
    // 실패한 결과는 캐시하지 않음 (재시도 가능성 고려)
    if (result.triples.length > 0) {
      const cacheKey = this.generateCacheKey(content);
      this.cache.set(cacheKey, result, ttl);
    }
  }

  /**
   * 캐시에서 항목 삭제
   * 
   * @param content Episodic Memory의 content
   * @returns 삭제 성공 여부
   */
  delete(content: string): boolean {
    const cacheKey = this.generateCacheKey(content);
    return this.cache.delete(cacheKey);
  }

  /**
   * 캐시 비우기
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 캐시 통계 반환
   * 
   * @returns 캐시 통계
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * TTL 기반 자동 무효화
   * 
   * PRD 6.13: 캐시 TTL 기반 자동 무효화 구현
   * - 만료된 항목 자동 제거
   * - CacheService의 내장 TTL 체크 활용
   * 
   * @returns 정리된 항목 수
   */
  cleanup(): number {
    // CacheService의 cleanup 메서드 호출
    // TTL이 만료된 항목 자동 제거
    return this.cache.cleanup();
  }

  /**
   * 캐시 크기 반환
   * 
   * @returns 현재 캐시 크기
   */
  size(): number {
    return this.cache.size();
  }
}

