/**
 * 간격 반복 관련 인터페이스 정의
 * 의존성 역전 원칙 (DIP) 적용
 */

import type {
IntervalCalculationResult,
MemoryData,
ReviewPerformance,
ReviewPriority,
ReviewSchedule,
SpacedRepetitionFeatures
} from '../types/spaced-repetition.types.js';

/**
 * 간격 계산 전략 인터페이스
 */
export interface IntervalCalculationStrategy {
  calculateInterval(
    currentInterval: number, 
    features: SpacedRepetitionFeatures
  ): IntervalCalculationResult;
}

/**
 * 리콜 확률 계산 인터페이스
 */
export interface RecallProbabilityCalculator {
  calculateRecallProbability(
    timeSinceLastReview: number,
    interval: number
  ): number;
}

/**
 * 리뷰 필요성 판단 인터페이스
 */
export interface ReviewNecessityChecker {
  needsReview(
    timeSinceLastReview: number,
    interval: number,
    threshold?: number
  ): boolean;
}

/**
 * 리뷰 스케줄링 인터페이스
 */
export interface ReviewScheduler {
  createReviewSchedule(
    memoryId: string,
    currentInterval: number,
    lastReviewDate: Date,
    features: SpacedRepetitionFeatures
  ): ReviewSchedule;
  
  createBatchReviewSchedules(memories: MemoryData[]): ReviewSchedule[];
}

/**
 * 성과 분석 인터페이스
 */
export interface PerformanceAnalyzer {
  analyzeReviewPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): ReviewPerformance;
}

/**
 * 우선순위 계산 인터페이스
 */
export interface PriorityCalculator {
  calculateReviewPriority(schedule: ReviewSchedule): number;
  calculateBatchPriorities(schedules: ReviewSchedule[]): ReviewPriority[];
}

/**
 * 최적 간격 추천 인터페이스
 */
export interface OptimalIntervalRecommender {
  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[],
    features: SpacedRepetitionFeatures
  ): number;
}

/**
 * 간격 반복 서비스 메인 인터페이스
 */
export interface SpacedRepetitionService {
  calculateNextInterval(
    currentInterval: number,
    features: SpacedRepetitionFeatures
  ): number;
  
  calculateRecallProbability(
    timeSinceLastReview: number,
    interval: number
  ): number;
  
  needsReview(
    timeSinceLastReview: number,
    interval: number,
    threshold?: number
  ): boolean;
  
  createReviewSchedule(
    memoryId: string,
    currentInterval: number,
    lastReviewDate: Date,
    features: SpacedRepetitionFeatures
  ): ReviewSchedule;
  
  createBatchReviewSchedules(memories: MemoryData[]): ReviewSchedule[];
  
  calculateReviewPriority(schedule: ReviewSchedule): number;
  
  analyzeReviewPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): ReviewPerformance;
  
  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[],
    features: SpacedRepetitionFeatures
  ): number;
}
