/**
 * 오래되고 사용되지 않는 기억을 자동으로 식별하여 저장 공간을 효율적으로 관리합니다.
 * Memento-Goals.md에 정의된 검증된 망각 공식을 구현하여 일관되고 공정한 망각 결정을 보장합니다.
 */

export interface ForgettingFeatures {
  recency: number;        // 최근성 (0-1)
  usage: number;          // 사용성 (0-1)
  duplication_ratio: number; // 중복 비율 (0-1)
  importance: number;     // 중요도 (0-1)
  pinned: boolean;        // 고정 여부
}

export interface ForgettingWeights {
  recency: number;        // U1 = 0.35
  usage: number;          // U2 = 0.25
  duplication: number;    // U3 = 0.20
  importance: number;     // U4 = 0.15
  pinned: number;         // U5 = 0.30
}

export interface ForgettingResult {
  memory_id: string;
  forget_score: number;
  should_forget: boolean;
  reason: string;
  features: ForgettingFeatures;
}

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
   * 최근성, 사용성, 중복도, 중요도, 고정 여부를 종합적으로 고려하여 공정한 망각 결정을 내리기 위해
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
   * 망각 점수가 임계값을 넘으면 저장 공간을 효율적으로 관리하기 위해 해당 기억을 망각 대상으로 결정합니다.
   * 임계값을 조정하여 망각 정책의 엄격도를 제어할 수 있도록 합니다.
   */
  shouldForget(forgetScore: number, threshold: number = 0.6): boolean {
    return forgetScore >= threshold;
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
    if (features.duplication_ratio > 0.7) {
      reasons.push('중복도 높음');
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
    last_accessed?: string;
    importance: number;
    pinned: boolean;
    type: string;
    view_count?: number;
    cite_count?: number;
    edit_count?: number;
  }, duplicates: number = 0, totalMemories: number = 1): ForgettingFeatures {
    // 시간에 따른 기억의 자연스러운 감쇠를 반영하여 오래된 기억을 식별합니다.
    const recency = this.calculateRecency(new Date(memory.created_at), memory.type);
    
    // 실제 사용 빈도를 반영하여 사용되지 않는 기억을 식별합니다.
    const usage = this.calculateUsage(
      memory.last_accessed ? new Date(memory.last_accessed) : undefined,
      memory.view_count || 0,
      memory.cite_count || 0,
      memory.edit_count || 0
    );
    
    // 유사한 내용의 중복 기억을 식별하여 저장 공간을 효율적으로 관리합니다.
    const duplication_ratio = totalMemories > 0 ? duplicates / totalMemories : 0;
    
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
    const ageDays = this.getAgeInDays(createdAt);
    const halfLife = this.getHalfLife(type);
    
    return Math.exp(-Math.log(2) * ageDays / halfLife);
  }

  /**
   * 실제 사용 빈도를 반영하여 사용되지 않는 기억을 식별합니다.
   * 접근 빈도와 사용 빈도를 종합하여 사용성을 정량화합니다.
   */
  private calculateUsage(
    lastAccessed?: Date,
    viewCount: number = 0,
    citeCount: number = 0,
    editCount: number = 0
  ): number {
    // 시간이 지날수록 기억의 관련성이 자연스럽게 감쇠하므로, 마지막 접근 시간을 기반으로 최근성 점수를 계산합니다.
    const accessScore = lastAccessed ? this.calculateAccessScore(lastAccessed) : 0;
    
    // 로그 스케일을 사용하여 사용 빈도의 차이를 완화하고 균형잡힌 점수를 생성합니다.
    const usageScore = Math.log(1 + viewCount) + 
                      2 * Math.log(1 + citeCount) + 
                      0.5 * Math.log(1 + editCount);
    
    // 점수를 0-1 범위로 정규화하여 다른 지표와 일관된 비교가 가능하도록 합니다.
    const normalizedUsage = Math.min(1, usageScore / 10); // 경험적으로 도출된 최대값을 사용하여 정규화합니다.
    
    return Math.max(accessScore, normalizedUsage);
  }

  /**
   * 마지막 접근 시간을 기반으로 최근성 점수를 계산하여 사용 빈도와 함께 평가합니다.
   * 30일 반감기를 사용하여 시간에 따른 감쇠를 반영합니다.
   */
  private calculateAccessScore(lastAccessed: Date): number {
    const daysSinceAccess = this.getAgeInDays(lastAccessed);
    
    // 30일 반감기를 사용하여 시간에 따른 자연스러운 감쇠를 반영합니다.
    return Math.exp(-daysSinceAccess / 30);
  }

  /**
   * 시간이 지날수록 기억의 관련성이 자연스럽게 감쇠하므로, 메모리의 생성 시간으로부터 경과된 일수를 계산하여 최근성 평가에 사용합니다.
   */
  private getAgeInDays(date: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return diffTime / (1000 * 60 * 60 * 24);
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
   * 중복도를 계산하고 각 메모리의 망각 점수를 산출하여 우선순위를 결정합니다.
   */
  analyzeForgetCandidates(memories: Array<{
    id: string;
    created_at: string;
    last_accessed?: string;
    importance: number;
    pinned: boolean;
    type: string;
    view_count?: number;
    cite_count?: number;
    edit_count?: number;
  }>): ForgettingResult[] {
    const results: ForgettingResult[] = [];
    const totalMemories = memories.length;
    
    // 중복 기억을 식별하기 위해 간단한 구현을 사용하여 저장 공간을 효율적으로 관리합니다.
    const contentMap = new Map<string, number>();
    memories.forEach(memory => {
      const key = memory.type; // 실제 구현에서는 내용 유사도로 계산하여 더 정확한 중복 감지를 수행합니다.
      contentMap.set(key, (contentMap.get(key) || 0) + 1);
    });
    
    for (const memory of memories) {
      const duplicates = (contentMap.get(memory.type) || 1) - 1;
      
      const features = this.calculateFeatures(memory, duplicates, totalMemories);
      const forgetScore = this.calculateForgetScore(features);
      const shouldForget = this.shouldForget(forgetScore);
      const reason = this.generateForgetReason(features, forgetScore);
      
      results.push({
        memory_id: memory.id,
        forget_score: forgetScore,
        should_forget: shouldForget,
        reason,
        features
      });
    }
    
    return results.sort((a, b) => b.forget_score - a.forget_score);
  }
}
