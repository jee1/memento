/**
 * 성과 분석 서비스
 * 단일 책임 원칙 (SRP) 적용
 */

import type { 
  ReviewSchedule, 
  ReviewPerformance 
} from '../../../../shared/types/spaced-repetition.types.js';
import type { PerformanceAnalyzer } from '../../../../shared/interfaces/spaced-repetition.interface.js';

/**
 * 기본 성과 분석기
 */
export class DefaultPerformanceAnalyzer implements PerformanceAnalyzer {
  analyzeReviewPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): ReviewPerformance {
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
}

/**
 * 상세 성과 분석기
 * 더 세밀한 성과 지표 제공
 */
export class DetailedPerformanceAnalyzer implements PerformanceAnalyzer {
  analyzeReviewPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): ReviewPerformance {
    const baseAnalysis = new DefaultPerformanceAnalyzer()
      .analyzeReviewPerformance(schedules, actualRecall);
    
    // 추가 분석 수행
    this.analyzePerformanceTrends(schedules, actualRecall);
    this.analyzeIntervalEffectiveness(schedules, actualRecall);
    
    return baseAnalysis;
  }

  private analyzePerformanceTrends(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): void {
    // 성과 트렌드 분석 로직
    const weeklyPerformance = this.calculateWeeklyPerformance(schedules, actualRecall);
    const trendDirection = this.calculateTrendDirection(weeklyPerformance);
    
    console.log(`성과 트렌드: ${trendDirection}`);
  }

  private analyzeIntervalEffectiveness(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): void {
    // 간격별 효과성 분석 로직
    const intervalEffectiveness = this.calculateIntervalEffectiveness(schedules, actualRecall);
    
    console.log('간격별 효과성:', intervalEffectiveness);
  }

  private calculateWeeklyPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): number[] {
    // 주별 성과 계산 로직
    return [];
  }

  private calculateTrendDirection(weeklyPerformance: number[]): string {
    if (weeklyPerformance.length < 2) return '데이터 부족';
    
    const recent = weeklyPerformance.slice(-2);
    if (recent.length < 2) return '데이터 부족';
    if ((recent[1] || 0) > (recent[0] || 0)) return '상승';
    if ((recent[1] || 0) < (recent[0] || 0)) return '하락';
    return '안정';
  }

  private calculateIntervalEffectiveness(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): Map<number, number> {
    const effectiveness = new Map<number, { total: number, successful: number }>();
    
    for (const schedule of schedules) {
      if (actualRecall.has(schedule.memory_id)) {
        const recalled = actualRecall.get(schedule.memory_id)!;
        const interval = schedule.current_interval;
        
        const current = effectiveness.get(interval) || { total: 0, successful: 0 };
        current.total++;
        if (recalled) current.successful++;
        effectiveness.set(interval, current);
      }
    }
    
    const result = new Map<number, number>();
    for (const [interval, stats] of effectiveness) {
      result.set(interval, stats.successful / stats.total);
    }
    
    return result;
  }
}

/**
 * 적응형 성과 분석기
 * 학습자의 성과 패턴을 학습하여 분석 개선
 */
export class AdaptivePerformanceAnalyzer implements PerformanceAnalyzer {
  private learningPatterns: Map<string, number[]> = new Map();
  private performanceThresholds: Map<string, number> = new Map();

  analyzeReviewPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): ReviewPerformance {
    const baseAnalysis = new DefaultPerformanceAnalyzer()
      .analyzeReviewPerformance(schedules, actualRecall);
    
    // 적응형 분석 수행
    this.updateLearningPatterns(schedules, actualRecall);
    this.adjustPerformanceThresholds();
    
    return baseAnalysis;
  }

  private updateLearningPatterns(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): void {
    for (const schedule of schedules) {
      if (actualRecall.has(schedule.memory_id)) {
        const recalled = actualRecall.get(schedule.memory_id)!;
        const performance = recalled ? 1 : 0;
        
        const pattern = this.learningPatterns.get(schedule.memory_id) || [];
        pattern.push(performance);
        
        // 최근 30개 기록만 유지
        if (pattern.length > 30) {
          pattern.shift();
        }
        
        this.learningPatterns.set(schedule.memory_id, pattern);
      }
    }
  }

  private adjustPerformanceThresholds(): void {
    for (const [memoryId, pattern] of this.learningPatterns) {
      if (pattern.length >= 10) {
        const averagePerformance = pattern.reduce((sum, perf) => sum + perf, 0) / pattern.length;
        this.performanceThresholds.set(memoryId, averagePerformance);
      }
    }
  }

  getPersonalizedThreshold(memoryId: string): number {
    return this.performanceThresholds.get(memoryId) || 0.7;
  }
}

/**
 * 예측 성과 분석기
 * 머신러닝 기반 성과 예측
 */
export class PredictivePerformanceAnalyzer implements PerformanceAnalyzer {
  private predictionModel: Map<string, number> = new Map();

  analyzeReviewPerformance(
    schedules: ReviewSchedule[],
    actualRecall: Map<string, boolean>
  ): ReviewPerformance {
    const baseAnalysis = new DefaultPerformanceAnalyzer()
      .analyzeReviewPerformance(schedules, actualRecall);
    
    // 예측 분석 수행
    this.predictPerformance(schedules);
    
    return baseAnalysis;
  }

  private predictPerformance(schedules: ReviewSchedule[]): void {
    for (const schedule of schedules) {
      const predictedPerformance = this.calculatePredictedPerformance(schedule);
      this.predictionModel.set(schedule.memory_id, predictedPerformance);
    }
  }

  private calculatePredictedPerformance(schedule: ReviewSchedule): number {
    // 간단한 예측 모델 (실제로는 더 복잡한 ML 모델 사용)
    const baseScore = schedule.recall_probability;
    const intervalFactor = Math.log(schedule.current_interval + 1) / 10;
    const multiplierFactor = Math.abs(schedule.multiplier - 1) / 2;
    
    return Math.max(0, Math.min(1, baseScore + intervalFactor - multiplierFactor));
  }

  getPredictedPerformance(memoryId: string): number {
    return this.predictionModel.get(memoryId) || 0.5;
  }
}
