/**
 * 간격 계산 서비스
 * 단일 책임 원칙 (SRP) 적용
 */

import type { 
  SpacedRepetitionFeatures, 
  SpacedRepetitionWeights,
  IntervalCalculationResult 
} from '../../../../../shared/types/spaced-repetition.types.js';
import type { IntervalCalculationStrategy } from '../../../../../shared/interfaces/spaced-repetition.interface.js';

/**
 * 기본 간격 계산 전략
 * Memento-Goals.md의 간격 반복 공식 구현
 */
export class DefaultIntervalStrategy implements IntervalCalculationStrategy {
  constructor(private weights: SpacedRepetitionWeights) {}

  calculateInterval(
    currentInterval: number,
    features: SpacedRepetitionFeatures
  ): IntervalCalculationResult {
    const { importance, usage, helpful_feedback, bad_feedback } = features;
    
    const multiplier = 1 + 
      this.weights.importance * importance +
      this.weights.usage * usage +
      this.weights.helpful_feedback * helpful_feedback -
      this.weights.bad_feedback * bad_feedback;
    
    const nextInterval = Math.ceil(currentInterval * multiplier);
    const confidence = this.calculateConfidence(features);
    
    return {
      nextInterval,
      multiplier,
      confidence
    };
  }

  private calculateConfidence(features: SpacedRepetitionFeatures): number {
    // 특징의 균형성을 기반으로 신뢰도 계산
    const { importance, usage, helpful_feedback, bad_feedback } = features;
    
    const balance = 1 - Math.abs(importance - usage);
    const feedbackBalance = 1 - Math.abs(helpful_feedback - bad_feedback);
    
    return (balance + feedbackBalance) / 2;
  }
}

/**
 * 보수적 간격 계산 전략
 * 더 짧은 간격으로 안전한 학습 보장
 */
export class ConservativeIntervalStrategy implements IntervalCalculationStrategy {
  constructor(private weights: SpacedRepetitionWeights) {}

  calculateInterval(
    currentInterval: number,
    features: SpacedRepetitionFeatures
  ): IntervalCalculationResult {
    const { importance, usage, helpful_feedback, bad_feedback } = features;
    
    // 보수적 계수 적용 (0.8배)
    const conservativeMultiplier = 0.8 * (1 + 
      this.weights.importance * importance +
      this.weights.usage * usage +
      this.weights.helpful_feedback * helpful_feedback -
      this.weights.bad_feedback * bad_feedback);
    
    const nextInterval = Math.ceil(currentInterval * conservativeMultiplier);
    const confidence = 0.9; // 보수적 전략은 높은 신뢰도
    
    return {
      nextInterval,
      multiplier: conservativeMultiplier,
      confidence
    };
  }
}

/**
 * 적응형 간격 계산 전략
 * 학습자의 성과에 따라 동적으로 조정
 */
export class AdaptiveIntervalStrategy implements IntervalCalculationStrategy {
  constructor(
    private weights: SpacedRepetitionWeights,
    private performanceHistory: boolean[] = []
  ) {}

  calculateInterval(
    currentInterval: number,
    features: SpacedRepetitionFeatures
  ): IntervalCalculationResult {
    const baseResult = new DefaultIntervalStrategy(this.weights)
      .calculateInterval(currentInterval, features);
    
    // 성과 기반 조정
    const performanceAdjustment = this.calculatePerformanceAdjustment();
    const adjustedInterval = Math.ceil(baseResult.nextInterval * performanceAdjustment);
    
    return {
      nextInterval: adjustedInterval,
      multiplier: baseResult.multiplier * performanceAdjustment,
      confidence: baseResult.confidence * 0.8 // 적응형은 약간 낮은 신뢰도
    };
  }

  private calculatePerformanceAdjustment(): number {
    if (this.performanceHistory.length === 0) return 1.0;
    
    const recentPerformance = this.performanceHistory.slice(-5);
    const successRate = recentPerformance.filter(success => success).length / recentPerformance.length;
    
    if (successRate > 0.8) return 1.2; // 성과 좋으면 간격 늘림
    if (successRate < 0.6) return 0.8; // 성과 나쁘면 간격 줄임
    return 1.0; // 중간 성과는 조정 없음
  }

  updatePerformanceHistory(success: boolean): void {
    this.performanceHistory.push(success);
    // 최근 20개 기록만 유지
    if (this.performanceHistory.length > 20) {
      this.performanceHistory.shift();
    }
  }
}
