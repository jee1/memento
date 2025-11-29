/**
 * 리콜 확률 계산 서비스
 * 단일 책임 원칙 (SRP) 적용
 */

import type { RecallProbabilityCalculator } from '../../../../shared/interfaces/spaced-repetition.interface.js';

/**
 * 기본 리콜 확률 계산기
 * 지수 감쇠 모델 사용: P = exp(-time_since_last_review / interval)
 */
export class DefaultRecallProbabilityCalculator implements RecallProbabilityCalculator {
  calculateRecallProbability(
    timeSinceLastReview: number, // 일 단위
    interval: number
  ): number {
    if (interval <= 0) return 0;
    if (timeSinceLastReview <= 0) return 1;
    
    return Math.exp(-timeSinceLastReview / interval);
  }
}

/**
 * 개선된 리콜 확률 계산기
 * 학습자 특성을 고려한 확률 모델
 */
export class EnhancedRecallProbabilityCalculator implements RecallProbabilityCalculator {
  constructor(
    private baseForgettingRate: number = 1.0,
    private learningEfficiency: number = 1.0
  ) {}

  calculateRecallProbability(
    timeSinceLastReview: number,
    interval: number
  ): number {
    if (interval <= 0) return 0;
    if (timeSinceLastReview <= 0) return 1;
    
    // 개선된 공식: P = exp(-forgetting_rate * time / interval)
    const forgettingRate = this.baseForgettingRate / this.learningEfficiency;
    return Math.exp(-forgettingRate * timeSinceLastReview / interval);
  }

  updateLearningEfficiency(performance: boolean[]): void {
    if (performance.length === 0) return;
    
    const successRate = performance.filter(success => success).length / performance.length;
    this.learningEfficiency = Math.max(0.5, Math.min(2.0, successRate * 2));
  }
}

/**
 * 적응형 리콜 확률 계산기
 * 개별 학습자의 망각 곡선을 학습
 */
export class AdaptiveRecallProbabilityCalculator implements RecallProbabilityCalculator {
  private forgettingCurves: Map<string, number[]> = new Map();
  
  calculateRecallProbability(
    timeSinceLastReview: number,
    interval: number,
    memoryId?: string
  ): number {
    if (interval <= 0) return 0;
    if (timeSinceLastReview <= 0) return 1;
    
    if (memoryId && this.forgettingCurves.has(memoryId)) {
      return this.calculatePersonalizedProbability(
        timeSinceLastReview,
        interval,
        memoryId
      );
    }
    
    // 기본 지수 감쇠 모델
    return Math.exp(-timeSinceLastReview / interval);
  }

  private calculatePersonalizedProbability(
    timeSinceLastReview: number,
    interval: number,
    memoryId: string
  ): number {
    const curve = this.forgettingCurves.get(memoryId)!;
    const normalizedTime = timeSinceLastReview / interval;
    
    // 개인별 망각 곡선 적용
    if (normalizedTime < curve.length) {
      const index = Math.floor(normalizedTime * curve.length);
      return curve[index] || 0;
    }
    
    return Math.exp(-timeSinceLastReview / interval);
  }

  updateForgettingCurve(memoryId: string, recallData: boolean[]): void {
    // 리콜 데이터를 기반으로 개인별 망각 곡선 업데이트
    const curve = this.estimateForgettingCurve(recallData);
    this.forgettingCurves.set(memoryId, curve);
  }

  private estimateForgettingCurve(recallData: boolean[]): number[] {
    // 간단한 망각 곡선 추정 (실제로는 더 복잡한 알고리즘 사용)
    const curve: number[] = [];
    const decayRate = 0.1;
    
    for (let i = 0; i < 100; i++) {
      curve.push(Math.exp(-decayRate * i));
    }
    
    return curve;
  }
}
