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

export interface EmbeddingSimilarity {
  queryEmbedding: number[];
  docEmbedding: number[];
}

export interface BM25Result {
  score: number;
  normalizedScore: number;
}

export interface UsageMetrics {
  viewCount: number;
  citeCount: number;
  editCount: number;
  lastAccessed?: Date | undefined;
}

export interface RelevanceInput {
  query: string;
  content: string;
  title?: string;
  tags: string[];
  embeddingSimilarity?: EmbeddingSimilarity | undefined;
  bm25Result?: BM25Result | undefined;
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
   * 관련성 점수 계산 (실제 구현)
   * 임베딩 유사도(60%) + BM25(30%) + 태그 매칭(5%) + 타이틀 히트(5%)
   */
  calculateRelevance(input: RelevanceInput): number {
    const { query, content, title, tags, embeddingSimilarity, bm25Result } = input;
    
    // 입력 검증
    if (!query || !content) return 0;
    
    // 1. 임베딩 유사도 (60% 가중치)
    const embeddingScore = embeddingSimilarity 
      ? this.calculateEmbeddingSimilarity(embeddingSimilarity.queryEmbedding, embeddingSimilarity.docEmbedding)
      : 0;
    
    // 2. BM25 점수 (30% 가중치)
    const bm25Score = bm25Result 
      ? this.normalizeBM25(bm25Result.score)
      : this.calculateSimpleBM25(query, content);
    
    // 3. 태그 매칭 (5% 가중치)
    const tagScore = this.calculateTagMatch(query, tags);
    
    // 4. 타이틀 히트 (5% 가중치)
    const titleScore = title ? this.calculateTitleHit(query, title) : 0;
    
    // 가중치 적용
    return 0.60 * embeddingScore + 
           0.30 * bm25Score + 
           0.05 * tagScore + 
           0.05 * titleScore;
  }

  /**
   * 임베딩 유사도 계산 (코사인 유사도)
   */
  private calculateEmbeddingSimilarity(queryEmbedding: number[], docEmbedding: number[]): number {
    if (queryEmbedding.length !== docEmbedding.length) return 0;
    
    const dotProduct = this.dotProduct(queryEmbedding, docEmbedding);
    const magnitudeA = this.magnitude(queryEmbedding);
    const magnitudeB = this.magnitude(docEmbedding);
    
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    
    const cosine = dotProduct / (magnitudeA * magnitudeB);
    return Math.max(0, cosine); // 음수 방지
  }

  /**
   * BM25 점수 정규화
   */
  private normalizeBM25(bm25Score: number, kNorm: number = 2.0): number {
    return bm25Score / (bm25Score + kNorm);
  }

  /**
   * 간단한 BM25 구현 (실제 BM25가 없는 경우)
   */
  private calculateSimpleBM25(query: string, content: string): number {
    // 입력 검증
    if (!query || !content) return 0;
    
    const queryTerms = query.toLowerCase().split(/\s+/);
    const contentTerms = content.toLowerCase().split(/\s+/);
    const termFreq = new Map<string, number>();
    
    // 용어 빈도 계산
    for (const term of contentTerms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
    }
    
    let score = 0;
    const k1 = 1.2;
    const b = 0.75;
    const docLength = contentTerms.length;
    const avgDocLength = 100; // 평균 문서 길이 (추정값)
    
    for (const term of queryTerms) {
      const tf = termFreq.get(term) || 0;
      if (tf > 0) {
        const idf = Math.log(2); // 간단한 IDF (실제로는 전체 문서 수 필요)
        const normalizedTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength)));
        score += idf * normalizedTf;
      }
    }
    
    return Math.min(1.0, score / 10); // 정규화
  }

  /**
   * 태그 매칭 (자카드 유사도)
   */
  private calculateTagMatch(query: string, tags: string[]): number {
    if (tags.length === 0) return 0;
    
    const queryTerms = new Set(query.toLowerCase().split(/\s+/));
    const tagTerms = new Set(tags.map(tag => tag.toLowerCase()));
    
    const intersection = new Set([...queryTerms].filter(x => tagTerms.has(x)));
    const union = new Set([...queryTerms, ...tagTerms]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 타이틀 히트 계산
   */
  private calculateTitleHit(query: string, title: string): number {
    const queryLower = query.toLowerCase();
    const titleLower = title.toLowerCase();
    
    let score = 0;
    
    // 정확 매치
    if (titleLower === queryLower) score += 1.0;
    // 접두 매치
    else if (titleLower.startsWith(queryLower)) score += 0.5;
    // N-gram 매치
    else if (this.hasNgramMatch(queryLower, titleLower)) score += 0.2;
    
    return Math.min(1.0, score);
  }

  /**
   * N-gram 매치 확인
   */
  private hasNgramMatch(query: string, text: string, n: number = 3): boolean {
    if (query.length < n || text.length < n) return false;
    
    const queryNgrams = this.generateNgrams(query, n);
    const textNgrams = this.generateNgrams(text, n);
    
    for (const ngram of queryNgrams) {
      if (textNgrams.has(ngram)) return true;
    }
    
    return false;
  }

  /**
   * N-gram 생성
   */
  private generateNgrams(text: string, n: number): Set<string> {
    const ngrams = new Set<string>();
    for (let i = 0; i <= text.length - n; i++) {
      ngrams.add(text.substring(i, i + n));
    }
    return ngrams;
  }

  /**
   * 벡터 내적 계산
   */
  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
  }

  /**
   * 벡터 크기 계산
   */
  private magnitude(vector: number[]): number {
    return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
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
   * 사용성 점수 계산 (실제 구현)
   * viewCount + citeCount(2배) + editCount(0.5배) 로그 스케일 집계
   */
  calculateUsage(metrics: UsageMetrics, batchMin?: number, batchMax?: number): number {
    // 입력 검증
    if (!metrics) return 0;
    
    const { viewCount, citeCount, editCount } = metrics;
    
    // 로그 스케일 집계
    const rawUsage = Math.log(1 + viewCount) + 
                     2 * Math.log(1 + citeCount) + 
                     0.5 * Math.log(1 + editCount);
    
    // 모든 값이 0인 경우 기본값 제공
    if (rawUsage === 0) {
      return 0.1; // 기본 사용성 점수
    }
    
    // 배치 정규화 (전체 배치에서 정규화)
    if (batchMin !== undefined && batchMax !== undefined) {
      return this.normalize(rawUsage, batchMin, batchMax);
    }
    
    // 개별 정규화 (기본값)
    return Math.min(1.0, rawUsage / 10);
  }

  /**
   * 배치 사용성 점수 계산 (여러 메모리에 대해)
   */
  calculateBatchUsage(metricsList: UsageMetrics[]): { normalized: number[], min: number, max: number } {
    const rawUsages = metricsList.map(metrics => {
      const { viewCount, citeCount, editCount } = metrics;
      return Math.log(1 + viewCount) + 
             2 * Math.log(1 + citeCount) + 
             0.5 * Math.log(1 + editCount);
    });
    
    const min = Math.min(...rawUsages);
    const max = Math.max(...rawUsages);
    
    const normalized = rawUsages.map(usage => 
      this.normalize(usage, min, max)
    );
    
    return { normalized, min, max };
  }

  /**
   * 정규화 함수
   */
  private normalize(value: number, min: number, max: number, epsilon: number = 1e-6): number {
    if (max === min) return 0.5; // 모든 값이 같을 때
    return (value - min) / (max - min + epsilon);
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
   * 텍스트 유사도 계산 (자카드 유사도)
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 하위 호환성을 위한 간단한 관련성 계산 (기존 API)
   */
  calculateRelevanceSimple(query: string, content: string, tags: string[] = []): number {
    return this.calculateRelevance({
      query,
      content,
      tags,
      embeddingSimilarity: undefined,
      bm25Result: undefined
    });
  }

  /**
   * 하위 호환성을 위한 간단한 사용성 계산 (기존 API)
   */
  calculateUsageSimple(lastAccessed?: Date): number {
    if (!lastAccessed) return 0.1;
    
    const daysSinceAccess = this.getAgeInDays(lastAccessed);
    return Math.exp(-daysSinceAccess / 30);
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
