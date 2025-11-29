/**
 * 리뷰 스케줄링 서비스
 * 단일 책임 원칙 (SRP) 적용
 */

import type { 
  SpacedRepetitionFeatures, 
  ReviewSchedule, 
  MemoryData 
} from '../../shared/types/spaced-repetition.types.js';
import type { 
  ReviewScheduler, 
  IntervalCalculationStrategy,
  RecallProbabilityCalculator,
  ReviewNecessityChecker 
} from '../../shared/interfaces/spaced-repetition.interface.js';

/**
 * 기본 리뷰 스케줄러
 */
export class DefaultReviewScheduler implements ReviewScheduler {
  constructor(
    private intervalStrategy: IntervalCalculationStrategy,
    private recallCalculator: RecallProbabilityCalculator,
    private necessityChecker: ReviewNecessityChecker,
    protected recallThreshold: number = 0.7
  ) {}

  createReviewSchedule(
    memoryId: string,
    currentInterval: number,
    lastReviewDate: Date,
    features: SpacedRepetitionFeatures
  ): ReviewSchedule {
    // 다음 간격 계산
    const intervalResult = this.intervalStrategy.calculateInterval(currentInterval, features);
    const nextInterval = intervalResult.nextInterval;
    
    // 다음 리뷰 날짜 계산
    const nextReview = new Date(lastReviewDate.getTime() + nextInterval * 24 * 60 * 60 * 1000);
    
    // 리콜 확률 및 필요성 계산
    const timeSinceLastReview = this.getDaysSince(lastReviewDate);
    const recallProb = this.recallCalculator.calculateRecallProbability(timeSinceLastReview, nextInterval);
    const needsReview = this.necessityChecker.needsReview(timeSinceLastReview, nextInterval, this.recallThreshold);
    
    return {
      memory_id: memoryId,
      current_interval: nextInterval,
      next_review: nextReview,
      recall_probability: recallProb,
      needs_review: needsReview,
      multiplier: intervalResult.multiplier
    };
  }

  createBatchReviewSchedules(memories: MemoryData[]): ReviewSchedule[] {
    return memories.map(memory => {
      const features: SpacedRepetitionFeatures = {
        importance: memory.importance,
        usage: memory.usage,
        helpful_feedback: memory.helpful_feedback,
        bad_feedback: memory.bad_feedback
      };
      
      return this.createReviewSchedule(
        memory.id,
        memory.current_interval,
        memory.last_review,
        features
      );
    });
  }

  private getDaysSince(date: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return diffTime / (1000 * 60 * 60 * 24);
  }
}

/**
 * 우선순위 기반 리뷰 스케줄러
 * 리뷰 우선순위를 고려한 스케줄링
 */
export class PriorityBasedReviewScheduler extends DefaultReviewScheduler {
  constructor(
    intervalStrategy: IntervalCalculationStrategy,
    recallCalculator: RecallProbabilityCalculator,
    necessityChecker: ReviewNecessityChecker,
    recallThreshold: number = 0.7,
    private maxDailyReviews: number = 20
  ) {
    super(intervalStrategy, recallCalculator, necessityChecker, recallThreshold);
  }

  createBatchReviewSchedules(memories: MemoryData[]): ReviewSchedule[] {
    const schedules = super.createBatchReviewSchedules(memories);
    
    // 우선순위별로 정렬하고 일일 제한 적용
    return this.prioritizeAndLimitSchedules(schedules);
  }

  private prioritizeAndLimitSchedules(schedules: ReviewSchedule[]): ReviewSchedule[] {
    // 우선순위 계산 (리콜 확률이 낮을수록, 간격이 길수록 우선순위 높음)
    const prioritizedSchedules = schedules
      .map(schedule => ({
        ...schedule,
        priority: this.calculatePriority(schedule)
      }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.maxDailyReviews);

    return prioritizedSchedules;
  }

  private calculatePriority(schedule: ReviewSchedule): number {
    const urgencyScore = 1 - schedule.recall_probability;
    const intervalScore = Math.log(schedule.current_interval + 1) / 10;
    return urgencyScore + intervalScore;
  }
}

/**
 * 적응형 리뷰 스케줄러
 * 학습자의 성과에 따라 동적으로 조정
 */
export class AdaptiveReviewScheduler extends DefaultReviewScheduler {
  private performanceHistory: Map<string, boolean[]> = new Map();

  constructor(
    intervalStrategy: IntervalCalculationStrategy,
    recallCalculator: RecallProbabilityCalculator,
    necessityChecker: ReviewNecessityChecker,
    recallThreshold: number = 0.7
  ) {
    super(intervalStrategy, recallCalculator, necessityChecker, recallThreshold);
  }

  createReviewSchedule(
    memoryId: string,
    currentInterval: number,
    lastReviewDate: Date,
    features: SpacedRepetitionFeatures
  ): ReviewSchedule {
    // 성과 기반 임계값 조정
    const adjustedThreshold = this.adjustThresholdForMemory(memoryId);
    
    const schedule = super.createReviewSchedule(
      memoryId,
      currentInterval,
      lastReviewDate,
      features
    );
    
    // 성과 기반 필요성 재평가
    schedule.needs_review = this.evaluateReviewNecessity(schedule, adjustedThreshold);
    
    return schedule;
  }

  private adjustThresholdForMemory(memoryId: string): number {
    const history = this.performanceHistory.get(memoryId) || [];
    if (history.length === 0) return this.recallThreshold;
    
    const recentPerformance = history.slice(-5);
    const successRate = recentPerformance.filter(success => success).length / recentPerformance.length;
    
    // 성과가 좋으면 임계값 낮춤 (더 적게 리뷰), 나쁘면 높임 (더 많이 리뷰)
    if (successRate > 0.8) return this.recallThreshold * 0.8;
    if (successRate < 0.6) return this.recallThreshold * 1.2;
    return this.recallThreshold;
  }

  private evaluateReviewNecessity(schedule: ReviewSchedule, threshold: number): boolean {
    return schedule.recall_probability <= threshold;
  }

  updatePerformance(memoryId: string, success: boolean): void {
    const history = this.performanceHistory.get(memoryId) || [];
    history.push(success);
    
    // 최근 20개 기록만 유지
    if (history.length > 20) {
      history.shift();
    }
    
    this.performanceHistory.set(memoryId, history);
  }
}
