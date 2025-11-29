/**
 * 간격 반복 팩토리
 * 의존성 주입 및 객체 생성 관리
 */

import type { 
  SpacedRepetitionConfig,
  SpacedRepetitionWeights 
} from '../../../../shared/types/spaced-repetition.types.js';
import type { 
  SpacedRepetitionService,
  IntervalCalculationStrategy,
  RecallProbabilityCalculator,
  ReviewNecessityChecker,
  ReviewScheduler,
  PerformanceAnalyzer,
  PriorityCalculator,
  OptimalIntervalRecommender
} from '../../../../shared/interfaces/spaced-repetition.interface.js';

// 서비스 구현들 import
import { DefaultIntervalStrategy, ConservativeIntervalStrategy, AdaptiveIntervalStrategy } from '../services/spaced-repetition/interval-calculation.service.js';
import { DefaultRecallProbabilityCalculator, EnhancedRecallProbabilityCalculator, AdaptiveRecallProbabilityCalculator } from '../services/spaced-repetition/recall-probability.service.js';
import { DefaultReviewScheduler, PriorityBasedReviewScheduler, AdaptiveReviewScheduler } from '../services/spaced-repetition/review-scheduling.service.js';
import { DefaultPerformanceAnalyzer, DetailedPerformanceAnalyzer, AdaptivePerformanceAnalyzer } from '../services/spaced-repetition/performance-analysis.service.js';
import { DefaultPriorityCalculator, WeightedPriorityCalculator, AdaptivePriorityCalculator, TimeBasedPriorityCalculator } from '../services/spaced-repetition/priority-calculation.service.js';
import { DefaultOptimalIntervalRecommender, AdaptiveOptimalIntervalRecommender, MLBasedOptimalIntervalRecommender, EnsembleOptimalIntervalRecommender } from '../services/spaced-repetition/optimal-interval.service.js';

/**
 * 간격 반복 팩토리
 */
export class SpacedRepetitionFactory {
  /**
   * 기본 설정으로 서비스 생성
   */
  static createDefaultService(config?: Partial<SpacedRepetitionConfig>): SpacedRepetitionService {
    const defaultConfig: SpacedRepetitionConfig = {
      weights: {
        importance: 0.6,
        usage: 0.4,
        helpful_feedback: 0.5,
        bad_feedback: 0.7
      },
      recallThreshold: 0.7,
      defaultInterval: 7,
      ...config
    };

    return this.createService(defaultConfig);
  }

  /**
   * 설정에 따라 서비스 생성
   */
  static createService(config: SpacedRepetitionConfig): SpacedRepetitionService {
    // 의존성 생성
    const intervalStrategy = this.createIntervalStrategy(config.weights);
    const recallCalculator = this.createRecallCalculator();
    const necessityChecker = this.createNecessityChecker(config.recallThreshold);
    const scheduler = this.createReviewScheduler(intervalStrategy, recallCalculator, necessityChecker, config.recallThreshold);
    const performanceAnalyzer = this.createPerformanceAnalyzer();
    const priorityCalculator = this.createPriorityCalculator();
    const optimalRecommender = this.createOptimalRecommender();

    return new SpacedRepetitionServiceImpl(
      intervalStrategy,
      recallCalculator,
      necessityChecker,
      scheduler,
      performanceAnalyzer,
      priorityCalculator,
      optimalRecommender
    );
  }

  /**
   * 간격 계산 전략 생성
   */
  static createIntervalStrategy(weights: SpacedRepetitionWeights, strategy: 'default' | 'conservative' | 'adaptive' = 'default'): IntervalCalculationStrategy {
    switch (strategy) {
      case 'conservative':
        return new ConservativeIntervalStrategy(weights);
      case 'adaptive':
        return new AdaptiveIntervalStrategy(weights);
      default:
        return new DefaultIntervalStrategy(weights);
    }
  }

  /**
   * 리콜 확률 계산기 생성
   */
  static createRecallCalculator(type: 'default' | 'enhanced' | 'adaptive' = 'default'): RecallProbabilityCalculator {
    switch (type) {
      case 'enhanced':
        return new EnhancedRecallProbabilityCalculator();
      case 'adaptive':
        return new AdaptiveRecallProbabilityCalculator();
      default:
        return new DefaultRecallProbabilityCalculator();
    }
  }

  /**
   * 리뷰 필요성 판단기 생성
   */
  static createNecessityChecker(threshold: number): ReviewNecessityChecker {
    return {
      needsReview: (timeSinceLastReview: number, interval: number, customThreshold?: number) => {
        const recallProb = Math.exp(-timeSinceLastReview / interval);
        return recallProb <= (customThreshold || threshold);
      }
    };
  }

  /**
   * 리뷰 스케줄러 생성
   */
  static createReviewScheduler(
    intervalStrategy: IntervalCalculationStrategy,
    recallCalculator: RecallProbabilityCalculator,
    necessityChecker: ReviewNecessityChecker,
    recallThreshold: number,
    type: 'default' | 'priority' | 'adaptive' = 'default'
  ): ReviewScheduler {
    switch (type) {
      case 'priority':
        return new PriorityBasedReviewScheduler(intervalStrategy, recallCalculator, necessityChecker, recallThreshold);
      case 'adaptive':
        return new AdaptiveReviewScheduler(intervalStrategy, recallCalculator, necessityChecker, recallThreshold);
      default:
        return new DefaultReviewScheduler(intervalStrategy, recallCalculator, necessityChecker, recallThreshold);
    }
  }

  /**
   * 성과 분석기 생성
   */
  static createPerformanceAnalyzer(type: 'default' | 'detailed' | 'adaptive' = 'default'): PerformanceAnalyzer {
    switch (type) {
      case 'detailed':
        return new DetailedPerformanceAnalyzer();
      case 'adaptive':
        return new AdaptivePerformanceAnalyzer();
      default:
        return new DefaultPerformanceAnalyzer();
    }
  }

  /**
   * 우선순위 계산기 생성
   */
  static createPriorityCalculator(type: 'default' | 'weighted' | 'adaptive' | 'time-based' = 'default'): PriorityCalculator {
    switch (type) {
      case 'weighted':
        return new WeightedPriorityCalculator();
      case 'adaptive':
        return new AdaptivePriorityCalculator();
      case 'time-based':
        return new TimeBasedPriorityCalculator();
      default:
        return new DefaultPriorityCalculator();
    }
  }

  /**
   * 최적 간격 추천기 생성
   */
  static createOptimalRecommender(type: 'default' | 'adaptive' | 'ml' | 'ensemble' = 'default'): OptimalIntervalRecommender {
    switch (type) {
      case 'adaptive':
        return new AdaptiveOptimalIntervalRecommender();
      case 'ml':
        return new MLBasedOptimalIntervalRecommender();
      case 'ensemble':
        return new EnsembleOptimalIntervalRecommender();
      default:
        return new DefaultOptimalIntervalRecommender();
    }
  }
}

/**
 * 간격 반복 서비스 구현
 */
class SpacedRepetitionServiceImpl implements SpacedRepetitionService {
  constructor(
    private intervalStrategy: IntervalCalculationStrategy,
    private recallCalculator: RecallProbabilityCalculator,
    private necessityChecker: ReviewNecessityChecker,
    private scheduler: ReviewScheduler,
    private performanceAnalyzer: PerformanceAnalyzer,
    private priorityCalculator: PriorityCalculator,
    private optimalRecommender: OptimalIntervalRecommender
  ) {}

  calculateNextInterval(currentInterval: number, features: any): number {
    const result = this.intervalStrategy.calculateInterval(currentInterval, features);
    return result.nextInterval;
  }

  calculateRecallProbability(timeSinceLastReview: number, interval: number): number {
    return this.recallCalculator.calculateRecallProbability(timeSinceLastReview, interval);
  }

  needsReview(timeSinceLastReview: number, interval: number, threshold?: number): boolean {
    return this.necessityChecker.needsReview(timeSinceLastReview, interval, threshold);
  }

  createReviewSchedule(memoryId: string, currentInterval: number, lastReviewDate: Date, features: any): any {
    return this.scheduler.createReviewSchedule(memoryId, currentInterval, lastReviewDate, features);
  }

  createBatchReviewSchedules(memories: any[]): any[] {
    return this.scheduler.createBatchReviewSchedules(memories);
  }

  calculateReviewPriority(schedule: any): number {
    return this.priorityCalculator.calculateReviewPriority(schedule);
  }

  analyzeReviewPerformance(schedules: any[], actualRecall: Map<string, boolean>): any {
    return this.performanceAnalyzer.analyzeReviewPerformance(schedules, actualRecall);
  }

  recommendOptimalInterval(currentInterval: number, recallHistory: boolean[], features: any): number {
    return this.optimalRecommender.recommendOptimalInterval(currentInterval, recallHistory, features);
  }
}
