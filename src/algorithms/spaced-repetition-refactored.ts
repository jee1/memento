/**
 * 리팩토링된 간격 반복 알고리즘
 * 클린코드 원칙을 적용한 새로운 구현
 * 기존 인터페이스와의 호환성 유지
 */

import type { 
  SpacedRepetitionFeatures,
  SpacedRepetitionWeights,
  ReviewSchedule,
  ReviewPerformance,
  MemoryData,
  SpacedRepetitionConfig
} from '../types/spaced-repetition.types.js';
import { getSpacedRepetitionService, initializeSpacedRepetitionWithDefaults } from '../services/spaced-repetition/spaced-repetition-container.js';

/**
 * 리팩토링된 간격 반복 알고리즘
 * 기존 SpacedRepetitionAlgorithm과 동일한 인터페이스 제공
 */
export class SpacedRepetitionAlgorithmRefactored {
  private readonly weights: SpacedRepetitionWeights;
  private readonly recallThreshold: number = 0.7;

  constructor(weights?: Partial<SpacedRepetitionWeights>) {
    this.weights = {
      importance: 0.6,
      usage: 0.4,
      helpful_feedback: 0.5,
      bad_feedback: 0.7,
      ...weights
    };

    // 컨테이너 초기화
    initializeSpacedRepetitionWithDefaults(this.weights);
  }

  /**
   * 다음 리뷰 간격 계산
   * 기존 메서드와 동일한 시그니처 유지
   */
  calculateNextInterval(
    currentInterval: number,
    features: SpacedRepetitionFeatures
  ): number {
    const service = getSpacedRepetitionService();
    return service.calculateNextInterval(currentInterval, features);
  }

  /**
   * 리콜 확률 계산
   * 기존 메서드와 동일한 시그니처 유지
   */
  calculateRecallProbability(
    timeSinceLastReview: number,
    interval: number
  ): number {
    const service = getSpacedRepetitionService();
    return service.calculateRecallProbability(timeSinceLastReview, interval);
  }

  /**
   * 리뷰 필요 여부 판단
   * 기존 메서드와 동일한 시그니처 유지
   */
  needsReview(
    timeSinceLastReview: number,
    interval: number,
    threshold: number = this.recallThreshold
  ): boolean {
    const service = getSpacedRepetitionService();
    return service.needsReview(timeSinceLastReview, interval, threshold);
  }

  /**
   * 리뷰 스케줄 생성
   * 기존 메서드와 동일한 시그니처 유지
   */
  createReviewSchedule(
    memoryId: string,
    currentInterval: number,
    lastReviewDate: Date,
    features: SpacedRepetitionFeatures
  ): ReviewSchedule {
    const service = getSpacedRepetitionService();
    return service.createReviewSchedule(memoryId, currentInterval, lastReviewDate, features);
  }

  /**
   * 배치 리뷰 스케줄 생성
   * 기존 메서드와 동일한 시그니처 유지
   */
  createBatchReviewSchedules(memories: MemoryData[]): ReviewSchedule[] {
    const service = getSpacedRepetitionService();
    return service.createBatchReviewSchedules(memories);
  }

  /**
   * 리뷰 우선순위 계산
   * 기존 메서드와 동일한 시그니처 유지
   */
  calculateReviewPriority(schedule: ReviewSchedule): number {
    const service = getSpacedRepetitionService();
    return service.calculateReviewPriority(schedule);
  }

  /**
   * 리뷰 성과 분석
   * 기존 메서드와 동일한 시그니처 유지
   */
  analyzeReviewPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): ReviewPerformance {
    const service = getSpacedRepetitionService();
    return service.analyzeReviewPerformance(schedules, actualRecall);
  }

  /**
   * 최적 간격 추천
   * 기존 메서드와 동일한 시그니처 유지
   */
  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[],
    features: SpacedRepetitionFeatures
  ): number {
    const service = getSpacedRepetitionService();
    return service.recommendOptimalInterval(currentInterval, recallHistory, features);
  }

  /**
   * 일수 계산 (private 메서드)
   * 기존 구현과 동일
   */
  private getDaysSince(date: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return diffTime / (1000 * 60 * 60 * 24);
  }
}

/**
 * 기존 SpacedRepetitionAlgorithm을 대체하는 팩토리 함수들
 */
export function createSpacedRepetitionAlgorithm(weights?: Partial<SpacedRepetitionWeights>): SpacedRepetitionAlgorithmRefactored {
  return new SpacedRepetitionAlgorithmRefactored(weights);
}

export function getSpacedRepetitionAlgorithm(): SpacedRepetitionAlgorithmRefactored {
  return new SpacedRepetitionAlgorithmRefactored();
}

export function resetSpacedRepetitionAlgorithm(): void {
  // 컨테이너 리셋
  // 실제 구현에서는 컨테이너의 리셋 기능을 호출
  // 현재는 빈 구현으로 처리
}

// 기존 클래스명으로도 export (호환성 유지)
export { SpacedRepetitionAlgorithmRefactored as SpacedRepetitionAlgorithm };
