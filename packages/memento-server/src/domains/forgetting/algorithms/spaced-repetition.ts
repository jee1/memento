/**
 * 학습 효율을 극대화하기 위해 최적의 리뷰 시점을 계산합니다.
 * Memento-Goals.md에 정의된 검증된 간격 반복 공식을 구현하여 과학적 근거에 기반한 학습 스케줄을 제공합니다.
 */

export interface SpacedRepetitionFeatures {
  importance: number;        // 중요도 (0-1)
  usage: number;            // 사용성 (0-1)
  helpful_feedback: number; // 도움됨 피드백 (0-1)
  bad_feedback: number;     // 나쁨 피드백 (0-1)
}

export interface SpacedRepetitionWeights {
  importance: number;        // A1 = 0.6
  usage: number;            // A2 = 0.4
  helpful_feedback: number; // A3 = 0.5
  bad_feedback: number;     // A4 = 0.7
}

export interface ReviewSchedule {
  memory_id: string;
  current_interval: number;  // 현재 간격 (일)
  next_review: Date;        // 다음 리뷰 날짜
  recall_probability: number; // 리콜 확률
  needs_review: boolean;    // 리뷰 필요 여부
  multiplier: number;       // 간격 배수
}

export class SpacedRepetitionAlgorithm {
  private readonly weights: SpacedRepetitionWeights;
  private readonly recallThreshold: number = 0.7; // 리콜 확률이 이 값 이하일 때 리뷰를 권장하여 망각 직전에 복습합니다.

  constructor(weights?: Partial<SpacedRepetitionWeights>) {
    this.weights = {
      importance: 0.6,        // A1: 중요도 가중치
      usage: 0.4,            // A2: 사용성 가중치
      helpful_feedback: 0.5, // A3: 도움됨 피드백 가중치
      bad_feedback: 0.7,     // A4: 나쁨 피드백 가중치
      ...weights
    };
  }

  /**
   * 학습자의 성과와 피드백을 반영하여 다음 리뷰 간격을 동적으로 조정합니다.
   * 중요도, 사용성, 긍정적 피드백은 간격을 늘리고, 부정적 피드백은 간격을 줄여 학습 효율을 최적화합니다.
   */
  calculateNextInterval(
    currentInterval: number,
    features: SpacedRepetitionFeatures
  ): number {
    const { importance, usage, helpful_feedback, bad_feedback } = features;
    
    const multiplier = 1 + 
      this.weights.importance * importance +
      this.weights.usage * usage +
      this.weights.helpful_feedback * helpful_feedback -
      this.weights.bad_feedback * bad_feedback;
    
    return Math.ceil(currentInterval * multiplier);
  }

  /**
   * 지수 감쇠 모델을 사용하여 시간 경과에 따른 기억 유지 확률을 계산합니다.
   * 마지막 리뷰로부터 경과된 시간과 현재 간격을 비교하여 리콜 가능성을 정량화합니다.
   */
  calculateRecallProbability(
    timeSinceLastReview: number, // 일 단위
    interval: number
  ): number {
    return Math.exp(-timeSinceLastReview / interval);
  }

  /**
   * 계산된 리콜 확률이 임계값 이하인지 확인하여 리뷰가 필요한지 판단합니다.
   * 망각 직전에 복습할 수 있도록 적절한 시점에 리뷰를 권장합니다.
   */
  needsReview(
    timeSinceLastReview: number,
    interval: number,
    threshold: number = this.recallThreshold
  ): boolean {
    const recallProb = this.calculateRecallProbability(timeSinceLastReview, interval);
    return recallProb <= threshold;
  }

  /**
   * 메모리의 특성과 학습 성과를 반영하여 최적의 리뷰 스케줄을 생성합니다.
   * 다음 리뷰 날짜, 간격, 리콜 확률 등을 종합하여 학습 계획을 수립합니다.
   */
  createReviewSchedule(
    memoryId: string,
    currentInterval: number,
    lastReviewDate: Date,
    features: SpacedRepetitionFeatures
  ): ReviewSchedule {
    const nextInterval = this.calculateNextInterval(currentInterval, features);
    const nextReview = new Date(lastReviewDate.getTime() + nextInterval * 24 * 60 * 60 * 1000);
    
    const timeSinceLastReview = this.getDaysSince(lastReviewDate);
    const recallProb = this.calculateRecallProbability(timeSinceLastReview, nextInterval);
    const needsReview = this.needsReview(timeSinceLastReview, nextInterval);
    
    return {
      memory_id: memoryId,
      current_interval: nextInterval,
      next_review: nextReview,
      recall_probability: recallProb,
      needs_review: needsReview,
      multiplier: nextInterval / currentInterval
    };
  }

  /**
   * 여러 메모리에 대해 일괄적으로 리뷰 스케줄을 생성하여 효율적인 학습 계획을 수립합니다.
   */
  createBatchReviewSchedules(
    memories: Array<{
      id: string;
      current_interval: number;
      last_review: Date;
      importance: number;
      usage: number;
      helpful_feedback: number;
      bad_feedback: number;
    }>
  ): ReviewSchedule[] {
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

  /**
   * 리콜 확률과 간격을 종합하여 리뷰 우선순위를 계산합니다.
   * 긴급한 리뷰를 우선 처리하여 학습 효율을 최적화합니다.
   */
  calculateReviewPriority(schedule: ReviewSchedule): number {
    // 리콜 확률이 낮을수록, 간격이 길수록 우선순위를 높게 설정하여 긴급한 리뷰를 우선 처리합니다.
    const urgencyScore = 1 - schedule.recall_probability;
    const intervalScore = Math.log(schedule.current_interval + 1) / 10; // 로그 스케일로 정규화하여 긴 간격의 영향력을 완화합니다.
    
    return urgencyScore + intervalScore;
  }

  /**
   * 실제 리콜 성과를 분석하여 알고리즘의 효과를 평가합니다.
   * 간격별 성과를 분석하여 최적의 간격을 찾기 위해
   */
  analyzeReviewPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean> // memory_id -> recall_success
  ): {
    totalMemories: number;
    reviewedMemories: number;
    averageRecallRate: number;
    performanceByInterval: Map<number, number>;
  } {
    const totalMemories = schedules.length;
    const reviewedMemories = schedules.filter(s => s.needs_review).length;
    
    let totalRecallRate = 0;
    let recallCount = 0;
    const performanceByInterval = new Map<number, { total: number; successful: number }>();
    
    for (const schedule of schedules) {
      if (actualRecall.has(schedule.memory_id)) {
        const recalled = actualRecall.get(schedule.memory_id)!;
        totalRecallRate += recalled ? 1 : 0;
        recallCount++;
        
        const interval = Math.floor(schedule.current_interval / 7) * 7; // 주 단위로 그룹화하여 유사한 간격의 성과를 비교합니다.
        const current = performanceByInterval.get(interval) || { total: 0, successful: 0 };
        current.total++;
        if (recalled) current.successful++;
        performanceByInterval.set(interval, current);
      }
    }
    
    const averageRecallRate = recallCount > 0 ? totalRecallRate / recallCount : 0;
    
    // 간격별 성과를 계산하여 최적의 간격을 찾기 위해
    const performanceByIntervalRate = new Map<number, number>();
    for (const [interval, stats] of performanceByInterval) {
      performanceByIntervalRate.set(interval, stats.successful / stats.total);
    }
    
    return {
      totalMemories,
      reviewedMemories,
      averageRecallRate,
      performanceByInterval: performanceByIntervalRate
    };
  }

  /**
   * 학습자의 실제 리콜 성과를 반영하여 최적의 간격을 추천합니다.
   * 성과가 좋으면 간격을 늘리고, 성과가 나쁘면 간격을 줄여 학습 효율을 최적화합니다.
   */
  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[], // 최근 리콜 성공/실패 기록
    features: SpacedRepetitionFeatures
  ): number {
    if (recallHistory.length === 0) {
      return currentInterval;
    }
    
    // 최근 성과를 기반으로 간격을 조정하여 학습자의 현재 상태를 반영합니다.
    const recentPerformance = recallHistory.slice(-5); // 최근 5회의 성과만 사용하여 최신 추세를 반영합니다.
    const successRate = recentPerformance.filter(success => success).length / recentPerformance.length;
    
    // 성과에 따라 간격을 동적으로 조정하여 학습 효율을 최적화합니다.
    let adjustmentFactor = 1.0;
    if (successRate > 0.8) {
      adjustmentFactor = 1.2; // 성과가 좋으면 간격을 늘려 학습 효율을 향상시키기 위해
    } else if (successRate < 0.6) {
      adjustmentFactor = 0.8; // 성과가 나쁘면 간격을 줄여 더 자주 복습하도록 합니다.
    }
    
    const baseInterval = this.calculateNextInterval(currentInterval, features);
    return Math.ceil(baseInterval * adjustmentFactor);
  }

  /**
   * 특정 날짜로부터 경과된 일수를 계산하여 시간 기반 계산에 사용합니다.
   */
  private getDaysSince(date: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return diffTime / (1000 * 60 * 60 * 24);
  }
}
