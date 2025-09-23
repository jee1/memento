/**
 * 간격 반복 알고리즘 구현
 * Memento-Goals.md의 간격 반복 공식 구현
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
  private readonly recallThreshold: number = 0.7; // 리콜 임계값

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
   * 다음 리뷰 간격 계산
   * interval = current_interval * (1 + A1*importance + A2*usage + A3*helpful - A4*bad)
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
   * 리콜 확률 계산
   * P = exp(-time_since_last_review / interval)
   */
  calculateRecallProbability(
    timeSinceLastReview: number, // 일 단위
    interval: number
  ): number {
    return Math.exp(-timeSinceLastReview / interval);
  }

  /**
   * 리뷰 필요 여부 판단
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
   * 리뷰 스케줄 생성
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
   * 배치 리뷰 스케줄 생성
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
   * 리뷰 우선순위 계산
   */
  calculateReviewPriority(schedule: ReviewSchedule): number {
    // 리콜 확률이 낮을수록, 간격이 길수록 우선순위 높음
    const urgencyScore = 1 - schedule.recall_probability;
    const intervalScore = Math.log(schedule.current_interval + 1) / 10; // 정규화
    
    return urgencyScore + intervalScore;
  }

  /**
   * 리뷰 성과 분석
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
        
        const interval = Math.floor(schedule.current_interval / 7) * 7; // 주 단위로 그룹화
        const current = performanceByInterval.get(interval) || { total: 0, successful: 0 };
        current.total++;
        if (recalled) current.successful++;
        performanceByInterval.set(interval, current);
      }
    }
    
    const averageRecallRate = recallCount > 0 ? totalRecallRate / recallCount : 0;
    
    // 간격별 성과 계산
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
   * 최적 간격 추천
   */
  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[], // 최근 리콜 성공/실패 기록
    features: SpacedRepetitionFeatures
  ): number {
    if (recallHistory.length === 0) {
      return currentInterval;
    }
    
    // 최근 성과 기반 조정
    const recentPerformance = recallHistory.slice(-5); // 최근 5회
    const successRate = recentPerformance.filter(success => success).length / recentPerformance.length;
    
    // 성과에 따른 조정 계수
    let adjustmentFactor = 1.0;
    if (successRate > 0.8) {
      adjustmentFactor = 1.2; // 성과 좋으면 간격 늘림
    } else if (successRate < 0.6) {
      adjustmentFactor = 0.8; // 성과 나쁘면 간격 줄임
    }
    
    const baseInterval = this.calculateNextInterval(currentInterval, features);
    return Math.ceil(baseInterval * adjustmentFactor);
  }

  /**
   * 일수 계산
   */
  private getDaysSince(date: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return diffTime / (1000 * 60 * 60 * 24);
  }
}
