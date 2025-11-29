/**
 * 우선순위 계산 서비스
 * 단일 책임 원칙 (SRP) 적용
 */

import type { 
  ReviewSchedule, 
  ReviewPriority 
} from '../../../../shared/types/spaced-repetition.types.js';
import type { PriorityCalculator } from '../../../../shared/interfaces/spaced-repetition.interface.js';

/**
 * 기본 우선순위 계산기
 * 리콜 확률과 간격을 기반으로 우선순위 계산
 */
export class DefaultPriorityCalculator implements PriorityCalculator {
  calculateReviewPriority(schedule: ReviewSchedule): number {
    // 리콜 확률이 낮을수록, 간격이 길수록 우선순위 높음
    const urgencyScore = 1 - schedule.recall_probability;
    const intervalScore = Math.log(schedule.current_interval + 1) / 10; // 정규화
    
    return urgencyScore + intervalScore;
  }

  calculateBatchPriorities(schedules: ReviewSchedule[]): ReviewPriority[] {
    return schedules.map(schedule => {
      const priority = this.calculateReviewPriority(schedule);
      const urgency = 1 - schedule.recall_probability;
      const intervalScore = Math.log(schedule.current_interval + 1) / 10;
      
      return {
        memory_id: schedule.memory_id,
        priority,
        urgency,
        interval_score: intervalScore
      };
    });
  }
}

/**
 * 가중치 기반 우선순위 계산기
 * 다양한 요소에 가중치를 적용한 우선순위 계산
 */
export class WeightedPriorityCalculator implements PriorityCalculator {
  constructor(
    private urgencyWeight: number = 0.6,
    private intervalWeight: number = 0.3,
    private multiplierWeight: number = 0.1
  ) {}

  calculateReviewPriority(schedule: ReviewSchedule): number {
    const urgencyScore = 1 - schedule.recall_probability;
    const intervalScore = Math.log(schedule.current_interval + 1) / 10;
    const multiplierScore = Math.abs(schedule.multiplier - 1) / 2; // 정규화
    
    return this.urgencyWeight * urgencyScore +
           this.intervalWeight * intervalScore +
           this.multiplierWeight * multiplierScore;
  }

  calculateBatchPriorities(schedules: ReviewSchedule[]): ReviewPriority[] {
    return schedules.map(schedule => {
      const priority = this.calculateReviewPriority(schedule);
      const urgency = 1 - schedule.recall_probability;
      const intervalScore = Math.log(schedule.current_interval + 1) / 10;
      
      return {
        memory_id: schedule.memory_id,
        priority,
        urgency,
        interval_score: intervalScore
      };
    });
  }
}

/**
 * 적응형 우선순위 계산기
 * 학습자의 성과 패턴을 고려한 우선순위 계산
 */
export class AdaptivePriorityCalculator implements PriorityCalculator {
  private performancePatterns: Map<string, number[]> = new Map();

  constructor(
    private baseCalculator: PriorityCalculator = new DefaultPriorityCalculator()
  ) {}

  calculateReviewPriority(schedule: ReviewSchedule): number {
    const basePriority = this.baseCalculator.calculateReviewPriority(schedule);
    const adaptationFactor = this.calculateAdaptationFactor(schedule.memory_id);
    
    return basePriority * adaptationFactor;
  }

  calculateBatchPriorities(schedules: ReviewSchedule[]): ReviewPriority[] {
    return schedules.map(schedule => {
      const priority = this.calculateReviewPriority(schedule);
      const urgency = 1 - schedule.recall_probability;
      const intervalScore = Math.log(schedule.current_interval + 1) / 10;
      
      return {
        memory_id: schedule.memory_id,
        priority,
        urgency,
        interval_score: intervalScore
      };
    });
  }

  private calculateAdaptationFactor(memoryId: string): number {
    const pattern = this.performancePatterns.get(memoryId);
    if (!pattern || pattern.length === 0) return 1.0;
    
    // 최근 성과 패턴 분석
    const recentPattern = pattern.slice(-10);
    const averagePerformance = recentPattern.reduce((sum, perf) => sum + perf, 0) / recentPattern.length;
    
    // 성과가 좋으면 우선순위 낮춤, 나쁘면 높임
    if (averagePerformance > 0.8) return 0.8;
    if (averagePerformance < 0.5) return 1.2;
    return 1.0;
  }

  updatePerformancePattern(memoryId: string, performance: number): void {
    const pattern = this.performancePatterns.get(memoryId) || [];
    pattern.push(performance);
    
    // 최근 50개 기록만 유지
    if (pattern.length > 50) {
      pattern.shift();
    }
    
    this.performancePatterns.set(memoryId, pattern);
  }
}

/**
 * 시간 기반 우선순위 계산기
 * 시간대와 요일을 고려한 우선순위 계산
 */
export class TimeBasedPriorityCalculator implements PriorityCalculator {
  constructor(
    private baseCalculator: PriorityCalculator = new DefaultPriorityCalculator(),
    private timeWeights: Map<number, number> = new Map() // 시간대별 가중치
  ) {
    // 기본 시간대 가중치 설정
    this.initializeTimeWeights();
  }

  calculateReviewPriority(schedule: ReviewSchedule): number {
    const basePriority = this.baseCalculator.calculateReviewPriority(schedule);
    const timeFactor = this.getTimeFactor();
    
    return basePriority * timeFactor;
  }

  calculateBatchPriorities(schedules: ReviewSchedule[]): ReviewPriority[] {
    return schedules.map(schedule => {
      const priority = this.calculateReviewPriority(schedule);
      const urgency = 1 - schedule.recall_probability;
      const intervalScore = Math.log(schedule.current_interval + 1) / 10;
      
      return {
        memory_id: schedule.memory_id,
        priority,
        urgency,
        interval_score: intervalScore
      };
    });
  }

  private getTimeFactor(): number {
    const hour = new Date().getHours();
    return this.timeWeights.get(hour) || 1.0;
  }

  private initializeTimeWeights(): void {
    // 학습에 최적화된 시간대 설정
    this.timeWeights.set(9, 1.2);   // 오전 9시
    this.timeWeights.set(14, 1.1);  // 오후 2시
    this.timeWeights.set(20, 1.3);  // 오후 8시
    this.timeWeights.set(22, 0.8);  // 오후 10시 (피로 고려)
  }
}
