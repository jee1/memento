/**
 * 간격 반복 관련 타입 정의
 * 클린코드 원칙에 따른 인터페이스 분리
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

export interface SpacedRepetitionConfig {
  weights: SpacedRepetitionWeights;
  recallThreshold: number;
  defaultInterval: number;
}

export interface ReviewSchedule {
  memory_id: string;
  current_interval: number;  // 현재 간격 (일)
  next_review: Date;        // 다음 리뷰 날짜
  recall_probability: number; // 리콜 확률
  needs_review: boolean;    // 리뷰 필요 여부
  multiplier: number;       // 간격 배수
}

export interface ReviewPerformance {
  totalMemories: number;
  reviewedMemories: number;
  averageRecallRate: number;
  performanceByInterval: Map<number, number>;
}

export interface MemoryData {
  id: string;
  current_interval: number;
  last_review: Date;
  importance: number;
  usage: number;
  helpful_feedback: number;
  bad_feedback: number;
}

export interface RecallHistory {
  memory_id: string;
  success: boolean;
  timestamp: Date;
}

export interface IntervalCalculationResult {
  nextInterval: number;
  multiplier: number;
  confidence: number;
}

export interface ReviewPriority {
  memory_id: string;
  priority: number;
  urgency: number;
  interval_score: number;
}
