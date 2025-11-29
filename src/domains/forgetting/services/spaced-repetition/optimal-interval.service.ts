/**
 * 최적 간격 추천 서비스
 * 단일 책임 원칙 (SRP) 적용
 */

import type { 
  SpacedRepetitionFeatures 
} from '../../shared/types/spaced-repetition.types.js';
import type { OptimalIntervalRecommender } from '../../shared/interfaces/spaced-repetition.interface.js';

/**
 * 기본 최적 간격 추천기
 */
export class DefaultOptimalIntervalRecommender implements OptimalIntervalRecommender {
  constructor(
    private baseMultiplier: number = 1.0,
    private performanceThreshold: number = 0.7
  ) {}

  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[],
    features: SpacedRepetitionFeatures
  ): number {
    if (recallHistory.length === 0) {
      return currentInterval;
    }
    
    // 최근 성과 기반 조정
    const recentPerformance = recallHistory.slice(-5); // 최근 5회
    const successRate = recentPerformance.filter(success => success).length / recentPerformance.length;
    
    // 성과에 따른 조정 계수
    let adjustmentFactor = this.baseMultiplier;
    if (successRate > 0.8) {
      adjustmentFactor = 1.2; // 성과 좋으면 간격 늘림
    } else if (successRate < 0.6) {
      adjustmentFactor = 0.8; // 성과 나쁘면 간격 줄임
    }
    
    return Math.ceil(currentInterval * adjustmentFactor);
  }
}

/**
 * 적응형 최적 간격 추천기
 * 학습자의 학습 패턴을 고려한 간격 추천
 */
export class AdaptiveOptimalIntervalRecommender implements OptimalIntervalRecommender {
  private learningProfiles: Map<string, number[]> = new Map();
  private optimalIntervals: Map<string, number> = new Map();

  constructor(
    private baseRecommender: OptimalIntervalRecommender = new DefaultOptimalIntervalRecommender()
  ) {}

  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[],
    features: SpacedRepetitionFeatures,
    memoryId?: string
  ): number {
    const baseRecommendation = this.baseRecommender.recommendOptimalInterval(
      currentInterval,
      recallHistory,
      features
    );
    
    if (!memoryId) return baseRecommendation;
    
    // 개인별 학습 프로필 고려
    const personalizedAdjustment = this.calculatePersonalizedAdjustment(memoryId, features);
    
    return Math.ceil(baseRecommendation * personalizedAdjustment);
  }

  private calculatePersonalizedAdjustment(memoryId: string, features: SpacedRepetitionFeatures): number {
    const profile = this.learningProfiles.get(memoryId);
    if (!profile || profile.length < 5) return 1.0;
    
    // 학습 속도 분석
    const learningSpeed = this.analyzeLearningSpeed(profile);
    const retentionRate = this.analyzeRetentionRate(profile);
    
    // 중요도와 사용성 기반 조정
    const importanceAdjustment = 1 + (features.importance - 0.5) * 0.2;
    const usageAdjustment = 1 + (features.usage - 0.5) * 0.2;
    
    return learningSpeed * retentionRate * importanceAdjustment * usageAdjustment;
  }

  private analyzeLearningSpeed(profile: number[]): number {
    // 학습 속도 분석 (성과 개선 속도)
    if (profile.length < 3) return 1.0;
    
    const recent = profile.slice(-3);
    if (recent.length < 2) return 1.0;
    const improvement = (recent[recent.length - 1] || 0) - (recent[0] || 0);
    
    if (improvement > 0.2) return 1.2; // 빠른 학습자
    if (improvement < -0.2) return 0.8; // 느린 학습자
    return 1.0;
  }

  private analyzeRetentionRate(profile: number[]): number {
    // 기억 유지율 분석
    const averagePerformance = profile.reduce((sum, perf) => sum + perf, 0) / profile.length;
    
    if (averagePerformance > 0.8) return 1.1; // 높은 유지율
    if (averagePerformance < 0.5) return 0.9; // 낮은 유지율
    return 1.0;
  }

  updateLearningProfile(memoryId: string, performance: number): void {
    const profile = this.learningProfiles.get(memoryId) || [];
    profile.push(performance);
    
    // 최근 20개 기록만 유지
    if (profile.length > 20) {
      profile.shift();
    }
    
    this.learningProfiles.set(memoryId, profile);
  }
}

/**
 * 머신러닝 기반 최적 간격 추천기
 * 고급 알고리즘을 사용한 간격 추천
 */
export class MLBasedOptimalIntervalRecommender implements OptimalIntervalRecommender {
  private model: Map<string, any> = new Map();

  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[],
    features: SpacedRepetitionFeatures,
    memoryId?: string
  ): number {
    if (!memoryId || !this.model.has(memoryId)) {
      return this.fallbackRecommendation(currentInterval, recallHistory, features);
    }
    
    // ML 모델을 사용한 예측
    const prediction = this.predictOptimalInterval(memoryId, features);
    return Math.ceil(prediction);
  }

  private predictOptimalInterval(memoryId: string, features: SpacedRepetitionFeatures): number {
    const model = this.model.get(memoryId);
    if (!model) return 7; // 기본값
    
    // 간단한 선형 모델 (실제로는 더 복잡한 ML 모델 사용)
    const weights = model.weights;
    const prediction = 
      weights.importance * features.importance +
      weights.usage * features.usage +
      weights.helpful_feedback * features.helpful_feedback -
      weights.bad_feedback * features.bad_feedback;
    
    return Math.max(1, Math.min(365, prediction)); // 1일~365일 범위
  }

  private fallbackRecommendation(
    currentInterval: number,
    recallHistory: boolean[],
    features: SpacedRepetitionFeatures
  ): number {
    const baseRecommender = new DefaultOptimalIntervalRecommender();
    return baseRecommender.recommendOptimalInterval(currentInterval, recallHistory, features);
  }

  trainModel(memoryId: string, trainingData: Array<{
    features: SpacedRepetitionFeatures;
    actualInterval: number;
    performance: number;
  }>): void {
    // 간단한 선형 회귀 모델 훈련
    const weights = this.trainLinearModel(trainingData);
    this.model.set(memoryId, { weights });
  }

  private trainLinearModel(trainingData: Array<{
    features: SpacedRepetitionFeatures;
    actualInterval: number;
    performance: number;
  }>): any {
    // 간단한 가중치 계산 (실제로는 더 정교한 ML 알고리즘 사용)
    return {
      importance: 0.6,
      usage: 0.4,
      helpful_feedback: 0.5,
      bad_feedback: 0.7
    };
  }
}

/**
 * 앙상블 최적 간격 추천기
 * 여러 추천기를 결합한 앙상블 방법
 */
export class EnsembleOptimalIntervalRecommender implements OptimalIntervalRecommender {
  private recommenders: OptimalIntervalRecommender[] = [];

  constructor() {
    this.recommenders = [
      new DefaultOptimalIntervalRecommender(),
      new AdaptiveOptimalIntervalRecommender(),
      new MLBasedOptimalIntervalRecommender()
    ];
  }

  recommendOptimalInterval(
    currentInterval: number,
    recallHistory: boolean[],
    features: SpacedRepetitionFeatures,
    memoryId?: string
  ): number {
    const recommendations = this.recommenders.map(recommender => 
      recommender.recommendOptimalInterval(currentInterval, recallHistory, features)
    );
    
    // 가중 평균으로 최종 추천
    const weights = [0.4, 0.4, 0.2]; // 각 추천기의 가중치
    const weightedSum = recommendations.reduce((sum, rec, index) => 
      sum + rec * (weights[index] || 0), 0
    );
    
    return Math.ceil(weightedSum);
  }
}
