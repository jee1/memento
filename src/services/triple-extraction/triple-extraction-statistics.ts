/**
 * Triple 추출 통계 수집 서비스
 * 
 * PRD 8.1: Triple 추출 통계
 * - 성공률: 성공한 Triple 추출 수 / 전체 시도 수
 * - 평균 추출 시간
 * - LLM 호출 횟수 및 비용
 * - 실패 사유별 통계
 */

import type { TripleExtractionResult, TripleExtractionFailureReason } from '../../shared/types/triple-extraction.js';

/**
 * Triple 추출 통계
 */
export interface TripleExtractionStatistics {
  // 전체 통계
  totalAttempts: number;              // 전체 시도 수
  totalSuccess: number;               // 성공한 Triple 추출 수
  totalFailures: number;               // 실패한 Triple 추출 수
  successRate: number;                 // 성공률 (0.0 ~ 1.0)
  
  // 시간 통계
  totalExtractionTime: number;         // 전체 추출 시간 (밀리초)
  averageExtractionTime: number;      // 평균 추출 시간 (밀리초)
  minExtractionTime: number;          // 최소 추출 시간 (밀리초)
  maxExtractionTime: number;          // 최대 추출 시간 (밀리초)
  
  // LLM 호출 통계
  totalLLMCalls: number;              // LLM 호출 횟수
  totalTokens: number;                // 총 토큰 수
  totalCost: number;                  // 총 비용 (USD)
  
  // 실패 사유별 통계
  failureReasons: Map<TripleExtractionFailureReason, number>;
  
  // Triple 통계
  totalTriplesExtracted: number;       // 추출된 총 Triple 수
  averageTriplesPerExtraction: number; // 추출당 평균 Triple 수
  
  // 캐시 통계
  cacheHits: number;                  // 캐시 히트 수
  cacheMisses: number;                // 캐시 미스 수
  cacheHitRate: number;               // 캐시 히트율 (0.0 ~ 1.0)
  
  // 타임스탬프
  firstRecorded: number;              // 첫 기록 시간
  lastRecorded: number;              // 마지막 기록 시간
}

/**
 * Triple 추출 통계 수집 서비스
 */
export class TripleExtractionStatisticsService {
  private statistics: TripleExtractionStatistics;
  private extractionTimes: number[] = []; // 추출 시간 히스토리 (최근 1000개)

  constructor() {
    this.statistics = this.initializeStatistics();
  }

  /**
   * 통계 초기화
   */
  private initializeStatistics(): TripleExtractionStatistics {
    return {
      totalAttempts: 0,
      totalSuccess: 0,
      totalFailures: 0,
      successRate: 0.0,
      totalExtractionTime: 0,
      averageExtractionTime: 0,
      minExtractionTime: Infinity,
      maxExtractionTime: 0,
      totalLLMCalls: 0,
      totalTokens: 0,
      totalCost: 0,
      failureReasons: new Map(),
      totalTriplesExtracted: 0,
      averageTriplesPerExtraction: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0.0,
      firstRecorded: Date.now(),
      lastRecorded: Date.now()
    };
  }

  /**
   * Triple 추출 결과 기록
   * 
   * @param result Triple 추출 결과
   * @param extractionTime 추출 시간 (밀리초)
   * @param fromCache 캐시에서 가져온 경우 true
   * @param llmCalls LLM 호출 횟수 (기본값: 1)
   * @param tokens 사용된 토큰 수 (기본값: 0)
   * @param cost 비용 (USD, 기본값: 0)
   */
  recordExtraction(
    result: TripleExtractionResult,
    extractionTime: number,
    fromCache: boolean = false,
    llmCalls: number = 1,
    tokens: number = 0,
    cost: number = 0
  ): void {
    this.statistics.totalAttempts++;
    this.statistics.lastRecorded = Date.now();

    // 성공/실패 통계
    const isSuccess = result.triples.length > 0;
    if (isSuccess) {
      this.statistics.totalSuccess++;
      this.statistics.totalTriplesExtracted += result.triples.length;
    } else {
      this.statistics.totalFailures++;
      
      // 실패 사유별 통계
      const failureReason = result.extractionInfo.failureReason || 'no_triple';
      const currentCount = this.statistics.failureReasons.get(failureReason) || 0;
      this.statistics.failureReasons.set(failureReason, currentCount + 1);
    }

    // 성공률 계산
    this.statistics.successRate = this.statistics.totalAttempts > 0
      ? this.statistics.totalSuccess / this.statistics.totalAttempts
      : 0.0;

    // 시간 통계
    if (!fromCache) {
      // 캐시에서 가져온 경우는 시간 통계에 포함하지 않음
      this.extractionTimes.push(extractionTime);
      
      // 최근 1000개만 유지 (메모리 효율성)
      if (this.extractionTimes.length > 1000) {
        this.extractionTimes.shift();
      }
      
      this.statistics.totalExtractionTime += extractionTime;
      this.statistics.minExtractionTime = Math.min(this.statistics.minExtractionTime, extractionTime);
      this.statistics.maxExtractionTime = Math.max(this.statistics.maxExtractionTime, extractionTime);
      
      // 평균 추출 시간 계산 (최근 1000개 기준)
      const sum = this.extractionTimes.reduce((acc, time) => acc + time, 0);
      this.statistics.averageExtractionTime = this.extractionTimes.length > 0
        ? sum / this.extractionTimes.length
        : 0;
    }

    // LLM 호출 통계 (캐시에서 가져온 경우는 제외)
    if (!fromCache) {
      this.statistics.totalLLMCalls += llmCalls;
      this.statistics.totalTokens += tokens;
      this.statistics.totalCost += cost;
    }

    // 캐시 통계
    if (fromCache) {
      this.statistics.cacheHits++;
    } else {
      this.statistics.cacheMisses++;
    }
    
    // 캐시 히트율 계산
    const totalCacheRequests = this.statistics.cacheHits + this.statistics.cacheMisses;
    this.statistics.cacheHitRate = totalCacheRequests > 0
      ? this.statistics.cacheHits / totalCacheRequests
      : 0.0;

    // 평균 Triple 수 계산
    this.statistics.averageTriplesPerExtraction = this.statistics.totalSuccess > 0
      ? this.statistics.totalTriplesExtracted / this.statistics.totalSuccess
      : 0;
  }

  /**
   * 통계 조회
   * 
   * @returns Triple 추출 통계
   */
  getStatistics(): TripleExtractionStatistics {
    return {
      ...this.statistics,
      failureReasons: new Map(this.statistics.failureReasons) // 복사본 반환
    };
  }

  /**
   * 통계 리셋
   */
  reset(): void {
    this.statistics = this.initializeStatistics();
    this.extractionTimes = [];
  }

  /**
   * 실패 사유별 통계 조회
   * 
   * @returns 실패 사유별 통계 (객체 형태)
   */
  getFailureReasonStatistics(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [reason, count] of this.statistics.failureReasons) {
      result[reason] = count;
    }
    return result;
  }
}

