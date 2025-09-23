/**
 * 검색 랭킹 알고리즘 구현
 * Memento-Goals.md의 검색 랭킹 공식 구현
 */

export interface SearchFeatures {
  relevance: number;
  recency: number;
  importance: number;
  usage: number;
  duplication_penalty: number;
}

export interface SearchRankingWeights {
  relevance: number;    // α = 0.50
  recency: number;      // β = 0.20
  importance: number;   // γ = 0.20
  usage: number;        // δ = 0.10
  duplication_penalty: number; // ε = 0.15
}

export class SearchRanking {
  private readonly weights: SearchRankingWeights;

  constructor(weights?: Partial<SearchRankingWeights>) {
    this.weights = {
      relevance: 0.50,
      recency: 0.20,
      importance: 0.20,
      usage: 0.10,
      duplication_penalty: 0.15,
      ...weights
    };
  }

  /**
   * 최종 검색 점수 계산
   * S = α * relevance + β * recency + γ * importance + δ * usage - ε * duplication_penalty
   */
  calculateFinalScore(features: SearchFeatures): number {
    return this.weights.relevance * features.relevance +
           this.weights.recency * features.recency +
           this.weights.importance * features.importance +
           this.weights.usage * features.usage -
           this.weights.duplication_penalty * features.duplication_penalty;
  }

  /**
   * 관련성 점수 계산 (임시 구현)
   * 실제로는 임베딩 유사도 + BM25 + 태그 매칭을 결합해야 함
   */
  calculateRelevance(query: string, content: string, tags: string[] = []): number {
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    
    let score = 0;
    
    // 정확 매치 (가장 높은 점수)
    if (contentLower.includes(queryLower)) {
      score += 0.8;
    }
    
    // 단어별 매치
    const queryWords = queryLower.split(/\s+/);
    const contentWords = contentLower.split(/\s+/);
    
    for (const word of queryWords) {
      if (contentWords.includes(word)) {
        score += 0.2;
      }
    }
    
    // 태그 매칭
    for (const tag of tags) {
      if (queryLower.includes(tag.toLowerCase()) || tag.toLowerCase().includes(queryLower)) {
        score += 0.3;
      }
    }
    
    return Math.min(1.0, score);
  }

  /**
   * 최근성 점수 계산
   * 반감기 기반 지수 감쇠
   */
  calculateRecency(createdAt: Date, type: string): number {
    const ageDays = this.getAgeInDays(createdAt);
    const halfLife = this.getHalfLife(type);
    
    return Math.exp(-Math.log(2) * ageDays / halfLife);
  }

  /**
   * 중요도 점수 계산
   */
  calculateImportance(userImportance: number, isPinned: boolean, type: string): number {
    const pinnedBoost = isPinned ? 0.2 : 0;
    const typeBoost = this.getTypeBoost(type);
    
    return Math.max(0, Math.min(1, userImportance + pinnedBoost + typeBoost));
  }

  /**
   * 사용성 점수 계산 (임시 구현)
   */
  calculateUsage(lastAccessed?: Date): number {
    if (!lastAccessed) return 0.1; // 기본값
    
    const daysSinceAccess = this.getAgeInDays(lastAccessed);
    return Math.exp(-daysSinceAccess / 30); // 30일 반감기
  }

  /**
   * 중복 패널티 계산 (MMR 구현)
   */
  calculateDuplicationPenalty(
    candidateContent: string,
    selectedContents: string[]
  ): number {
    if (selectedContents.length === 0) return 0;
    
    let maxSimilarity = 0;
    
    for (const selectedContent of selectedContents) {
      const similarity = this.calculateTextSimilarity(candidateContent, selectedContent);
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }
    
    return maxSimilarity;
  }

  /**
   * 텍스트 유사도 계산 (간단한 구현)
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

  /**
   * 나이 계산 (일 단위)
   */
  private getAgeInDays(date: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return diffTime / (1000 * 60 * 60 * 24);
  }

  /**
   * 타입별 반감기 (일 단위)
   */
  private getHalfLife(type: string): number {
    switch (type) {
      case 'working': return 2;
      case 'episodic': return 30;
      case 'semantic': return 180;
      case 'procedural': return 90;
      default: return 30;
    }
  }

  /**
   * 타입별 부스트 점수
   */
  private getTypeBoost(type: string): number {
    switch (type) {
      case 'semantic': return 0.1;
      case 'episodic': return 0.0;
      case 'working': return -0.05;
      case 'procedural': return 0.05;
      default: return 0.0;
    }
  }
}
