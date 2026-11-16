import { daysBetween } from '../../../shared/utils/date.js';

/**
 * 오래되고 사용되지 않는 기억을 자동으로 식별하여 저장 공간을 효율적으로 관리합니다.
 * Memento-Goals.md에 정의된 검증된 망각 공식을 구현하여 일관되고 공정한 망각 결정을 보장합니다.
 */

export interface ForgettingFeatures {
  recency: number;        // 최근성 (0-1)
  usage: number;          // 사용성 (0-1)
  duplication_ratio: number; // 유형별 고정 비중 (TYPE_DUPLICATION_RATIO)
  importance: number;     // 중요도 (0-1)
  pinned: boolean;        // 고정 여부
}

interface ForgettingWeights {
  recency: number;        // U1 = 0.35
  usage: number;          // U2 = 0.25
  duplication: number;    // U3 = 0.20
  importance: number;     // U4 = 0.15
  pinned: number;         // U5 = 0.30
}

export interface ForgettingResult {
  memory_id: string;
  forget_score: number;
  reason: string;
  features: ForgettingFeatures;
}

/**
 * 같은 유형 기억의 비중. 2026-11 운영 DB 의 유형 비중을 고정값으로 둔다 (#1749).
 * 정리 때마다 다시 세면 episodic 이 지워질수록 semantic 비중이 올라 지식 기억이 연쇄로 지워졌다.
 */
const TYPE_DUPLICATION_RATIO: Record<string, number> = {
  episodic: 0.57,
  semantic: 0.39,
  procedural: 0.04,
  working: 0.01,
};

export class ForgettingAlgorithm {
  private readonly weights: ForgettingWeights;

  constructor(weights?: Partial<ForgettingWeights>) {
    this.weights = {
      recency: 0.35,      // U1: 최근성 가중치
      usage: 0.25,        // U2: 사용성 가중치
      duplication: 0.20,  // U3: 중복 가중치
      importance: 0.15,   // U4: 중요도 가중치
      pinned: 0.30,       // U5: 고정 가중치
      ...weights
    };
  }

  /**
   * 단일 특징만으로는 망각 여부를 정확히 판단할 수 없으므로, 다차원 특징을 가중 평균하여 망각 가능성을 정량적으로 평가합니다.
   * 최근성, 사용성, 중복도, 중요도, 고정 여부를 종합적으로 고려하여 공정한 망각 결정을 내립니다.
   */
  calculateForgetScore(features: ForgettingFeatures): number {
    const { recency, usage, duplication_ratio, importance, pinned } = features;
    
    const recencyScore = this.weights.recency * (1 - recency);
    const usageScore = this.weights.usage * (1 - usage);
    const duplicationScore = this.weights.duplication * duplication_ratio;
    const importanceScore = this.weights.importance * importance;
    const pinnedScore = this.weights.pinned * (pinned ? 1 : 0);
    
    return recencyScore + usageScore + duplicationScore - importanceScore - pinnedScore;
  }


  /**
   * 사용자에게 망각 결정의 근거를 명확히 전달하여 투명성을 보장합니다.
   * 다양한 특징을 분석하여 구체적인 망각 이유를 제공합니다.
   */
  generateForgetReason(features: ForgettingFeatures, forgetScore: number): string {
    const reasons: string[] = [];
    
    if (features.recency < 0.3) {
      reasons.push('오래된 기억');
    }
    if (features.usage < 0.2) {
      reasons.push('사용되지 않음');
    }
    if (features.importance < 0.3) {
      reasons.push('중요도 낮음');
    }
    if (!features.pinned) {
      reasons.push('고정되지 않음');
    }
    
    if (reasons.length === 0) {
      return `망각 점수 높음 (${forgetScore.toFixed(3)})`;
    }
    
    return reasons.join(', ');
  }

  /**
   * 망각 알고리즘이 정확한 판단을 내리려면 메모리의 다양한 특징이 정량화되어야 하므로, 필요한 입력 데이터를 준비합니다.
   * 최근성, 사용성, 중복도, 중요도 등을 계산하여 종합적인 평가를 수행합니다.
   */
  calculateFeatures(memory: {
    created_at: string;
    /** 마지막으로 쓰인 시각. 없으면 created_at */
    last_used_at?: string;
    recall_count?: number;
    importance: number;
    pinned: boolean;
    type: string;
  }): ForgettingFeatures {
    // 시간에 따른 기억의 자연스러운 감쇠를 반영하여 오래된 기억을 식별합니다.
    const recency = this.calculateRecency(new Date(memory.created_at), memory.type);
    
    const usage = this.calculateUsage(new Date(memory.last_used_at ?? memory.created_at), memory.recall_count ?? 0);
    
    const duplication_ratio = TYPE_DUPLICATION_RATIO[memory.type] ?? 0;
    
    // 사용자가 명시적으로 설정한 중요도를 그대로 사용하여 사용자의 의도를 존중합니다.
    const importance = memory.importance;
    
    return {
      recency,
      usage,
      duplication_ratio,
      importance,
      pinned: memory.pinned
    };
  }

  /**
   * 시간에 따른 기억의 자연스러운 감쇠를 반영하여 오래된 기억을 식별합니다.
   * 반감기 기반 지수 감쇠를 사용하여 시간이 지날수록 망각 가능성이 증가하도록 설계합니다.
   */
  private calculateRecency(createdAt: Date, type: string): number {
    const ageDays = daysBetween(new Date(), createdAt);
    const halfLife = this.getHalfLife(type);
    
    return Math.exp(-Math.log(2) * ageDays / halfLife);
  }

  /**
   * 마지막 쓰임(recall, 주입)에서 지난 시간과 쓰인 횟수(meta_memory_stats, #1751)로 사용성을 0~1 로 낸다.
   */
  private calculateUsage(lastUsed: Date, recallCount: number): number {
    const accessScore = this.calculateAccessScore(lastUsed);
    const countScore = Math.min(1, Math.log(1 + recallCount) / 10);
    return Math.max(accessScore, countScore);
  }

  /**
   * 마지막 접근 시간을 기반으로 최근성 점수를 계산하여 사용 빈도와 함께 평가합니다.
   * 30일 반감기를 사용하여 시간에 따른 감쇠를 반영합니다.
   */
  private calculateAccessScore(lastAccessed: Date): number {
    const daysSinceAccess = daysBetween(new Date(), lastAccessed);
    
    // 30일 반감기를 사용하여 시간에 따른 자연스러운 감쇠를 반영합니다.
    return Math.exp(-daysSinceAccess / 30);
  }

  /**
   * 메모리 타입에 따라 다른 반감기를 설정하여 타입별 특성에 맞는 감쇠 속도를 적용합니다.
   * working 메모리는 빠르게, semantic 메모리는 천천히 감쇠하도록 설계합니다.
   */
  private getHalfLife(type: string): number {
    switch (type) {
      case 'working': return 2;      // 2일
      case 'episodic': return 30;    // 30일
      case 'semantic': return 180;   // 180일
      case 'procedural': return 90;  // 90일
      default: return 30;
    }
  }

  /**
   * 여러 메모리를 일괄 분석하여 망각 후보를 선정합니다.
   * 각 메모리의 망각 점수를 산출해 높은 순으로 정렬합니다.
   */
  analyzeForgetCandidates(memories: Array<{
    id: string;
    created_at: string;
    last_used_at?: string;
    recall_count?: number;
    importance: number;
    pinned: boolean;
    type: string;
  }>): ForgettingResult[] {
    return memories
      .map((memory) => {
        const features = this.calculateFeatures(memory);
        const forgetScore = this.calculateForgetScore(features);
        return {
          memory_id: memory.id,
          forget_score: forgetScore,
          reason: this.generateForgetReason(features, forgetScore),
          features,
        };
      })
      .sort((a, b) => b.forget_score - a.forget_score);
  }
}
