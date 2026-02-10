/**
 * 검색 결과의 관련성을 정량적으로 평가하여 사용자에게 가장 유용한 결과를 우선 제공합니다.
 * Memento-Goals.md에 정의된 검증된 랭킹 공식을 구현하여 일관되고 신뢰할 수 있는 검색 품질을 보장합니다.
 * 
 * 가중치는 ranking-weights.toml 설정 파일에서 로드하며, 파일이 없으면 constants.ts의 기본값을 사용합니다.
 */

export interface SearchFeatures {
  relevance: number;
  recency: number;
  importance: number;
  usage: number;
  duplication_penalty: number;
  consolidation_score?: number; // Consolidation Score (선택적)
  relation_weight?: number; // 관계 가중치 (관계 그래프 기반)
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name_match?: boolean; // workflow_name 매칭 여부
  skill_name_match?: boolean; // skill_name 매칭 여부
  trigger_conditions_match?: boolean; // trigger_conditions 매칭 여부
  // Process Attribute (Issue #91): recall 시 process 적합도 (0~1, 미제공 시 1)
  process_attribute_fit?: number;
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

import { getRankingWeights } from '../../../shared/config/ranking-weights-loader.js';
import { SEARCH_RANKING } from '../../../shared/config/constants.js';

export interface SearchRankingWeights {
  relevance: number;    // α = 0.45
  recency: number;      // β = 0.20
  importance: number;   // γ = 0.20
  usage: number;        // δ = 0.10
  relation_weight: number; // ζ = 0.15
  duplication_penalty: number; // ε = 0.10
  consolidation_score?: number; // w2 = 0.2 (기본값, 최대 0.4)
  process_attribute_fit?: number; // θ = 0.1 (Issue #91, process 적합도 가중치)
}

/**
 * 사용자의 검색 목적에 따라 다른 가중치를 적용하여 맞춤형 검색 결과를 제공합니다.
 */
export type SearchProfile = 'recent' | 'balanced' | 'memory';

/**
 * 벡터 유사도와 통합 점수의 균형을 조절하여 검색 정확도를 최적화합니다.
 */
export interface ConsolidationScoreWeights {
  vectorSimilarity: number; // w1
  consolidationScore: number; // w2 (최대 0.4)
}

export class SearchRanking {
  private readonly weights: SearchRankingWeights;

  constructor(weights?: Partial<SearchRankingWeights>) {
    // 설정 파일에서 가중치 로드 (없으면 constants.ts의 기본값 사용)
    const configWeights = getRankingWeights();
    const defaultWeights = SEARCH_RANKING.DEFAULT_WEIGHTS;
    
    this.weights = {
      relevance: configWeights.ranking_weights.alpha ?? defaultWeights.relevance,
      recency: configWeights.ranking_weights.beta ?? defaultWeights.recency,
      importance: configWeights.ranking_weights.gamma ?? defaultWeights.importance,
      usage: configWeights.ranking_weights.delta ?? defaultWeights.usage,
      relation_weight: configWeights.ranking_weights.zeta ?? defaultWeights.relation_weight,
      duplication_penalty: configWeights.ranking_weights.epsilon ?? defaultWeights.duplication_penalty,
      consolidation_score: defaultWeights.consolidation_score,
      process_attribute_fit: configWeights.ranking_weights.theta ?? defaultWeights.process_attribute_fit,
      ...weights
    };
  }

  /**
   * Procedural Memory 특화 가중치를 계산합니다.
   * workflow_name 매칭 시 +0.1, skill_name 매칭 시 +0.1, trigger_conditions 매칭 시 +0.15의 부스트를 제공합니다.
   * 
   * @param features 검색 특징 객체
   * @returns Procedural Memory 부스트 점수 (0.0 ~ 0.35)
   */
  calculateProceduralMemoryBoost(features: SearchFeatures): number {
    let boost = 0;
    
    if (features.workflow_name_match) {
      boost += SEARCH_RANKING.PROCEDURAL_MEMORY_BOOST.workflow_name_match;
    }
    
    if (features.skill_name_match) {
      boost += SEARCH_RANKING.PROCEDURAL_MEMORY_BOOST.skill_name_match;
    }
    
    if (features.trigger_conditions_match) {
      boost += SEARCH_RANKING.PROCEDURAL_MEMORY_BOOST.trigger_conditions_match;
    }
    
    return Math.min(boost, SEARCH_RANKING.PROCEDURAL_MEMORY_BOOST.max_boost);
  }

  /**
   * 단일 지표만으로는 검색 결과의 품질을 정확히 평가할 수 없으므로, 여러 지표를 가중 평균하여 종합적인 평가를 수행합니다.
   * 관련성, 최근성, 중요도, 사용성, 관계 가중치를 결합하고 중복 패널티를 적용하여 사용자에게 가장 유용한 결과를 우선 제공합니다.
   * 
   * Consolidation Score가 제공되면 벡터 유사도(relevance)를 보완하는 추가 신호로 활용합니다.
   * 다른 신호들(recency, importance, usage, duplication_penalty)은 그대로 유지하여 다차원 랭킹을 보장합니다.
   * 
   * Procedural Memory 특화 가중치가 제공되면 최종 점수에 부스트를 추가합니다.
   */
  calculateFinalScore(features: SearchFeatures): number {
    // 기본 점수 계산: 모든 신호를 포함한 다차원 랭킹
    let relevanceScore: number;
    
    // Consolidation Score가 있으면 relevance를 보완하는 신호로 활용
    if (features.consolidation_score !== undefined && this.weights.consolidation_score !== undefined) {
      // 통합 점수의 영향력을 제한하여 벡터 유사도의 중요성을 보장합니다.
      const consolidationWeight = Math.min(this.weights.consolidation_score, SEARCH_RANKING.CONSOLIDATION_SCORE_MAX);
      const relevanceWeight = 1 - consolidationWeight;
      
      // 벡터 유사도와 통합 점수를 결합하여 보완된 관련성 점수를 계산합니다.
      const vectorSimilarity = features.relevance;
      const consolidationScore = features.consolidation_score;
      
      // relevance를 consolidation_score로 보완 (다른 신호들은 유지)
      relevanceScore = relevanceWeight * vectorSimilarity + consolidationWeight * consolidationScore;
    } else {
      // Consolidation Score가 없으면 기존 relevance 사용
      relevanceScore = features.relevance;
    }

    // 다차원 랭킹: 모든 신호를 포함한 최종 점수 계산
    const finalScore = this.weights.relevance * relevanceScore +
                      this.weights.recency * features.recency +
                      this.weights.importance * features.importance +
                      this.weights.usage * features.usage +
                      (this.weights.relation_weight * (features.relation_weight || 0)) -
                      this.weights.duplication_penalty * features.duplication_penalty;

    // Procedural Memory 특화 가중치 부스트 적용
    const proceduralBoost = this.calculateProceduralMemoryBoost(features);
    // Process Attribute 적합도 가중치 (Issue #91): process_id로 검색할 때만 반영, 미제공 시 보정 없음
    const processFitWeight = this.weights.process_attribute_fit ?? 0;
    const processFit =
      features.process_attribute_fit !== undefined
        ? processFitWeight * features.process_attribute_fit
        : 0;
    return finalScore + proceduralBoost + processFit;
  }

  /**
   * 사용자의 검색 목적에 맞는 가중치를 제공하여 최적의 검색 결과를 제공합니다.
   * 최근 정보를 우선하는 경우, 균형잡힌 검색, 장기 기억 중심 검색 등 다양한 시나리오를 지원합니다.
   */
  getConsolidationScoreWeights(profile: SearchProfile = 'balanced'): ConsolidationScoreWeights {
    switch (profile) {
      case 'recent':
        return SEARCH_RANKING.CONSOLIDATION_WEIGHTS.recent;
      case 'balanced':
        return SEARCH_RANKING.CONSOLIDATION_WEIGHTS.balanced;
      case 'memory':
        return SEARCH_RANKING.CONSOLIDATION_WEIGHTS.memory; // 상한 0.4가 적용되어 벡터 유사도의 최소 비율을 보장합니다.
      default:
        return SEARCH_RANKING.CONSOLIDATION_WEIGHTS.balanced;
    }
  }

  /**
   * 벡터 유사도와 통합 점수를 프로파일에 맞게 결합하여 최종 검색 점수를 계산합니다.
   * 사용자의 검색 목적에 따라 다른 가중치를 적용하여 맞춤형 검색 결과를 제공합니다.
   */
  calculateFinalScoreWithConsolidation(
    vectorSimilarity: number,
    consolidationScore: number,
    profile: SearchProfile = 'balanced'
  ): number {
    const weights = this.getConsolidationScoreWeights(profile);
    
    // 통합 점수의 영향력을 제한하여 벡터 유사도의 중요성을 보장합니다.
    const w2 = Math.min(weights.consolidationScore, SEARCH_RANKING.CONSOLIDATION_SCORE_MAX);
    const w1 = 1 - w2; // 가중치의 합이 1이 되도록 보장하여 점수 범위의 일관성을 유지합니다.
    
    return w1 * vectorSimilarity + w2 * consolidationScore;
  }

  /**
   * 단일 지표만으로는 검색 관련성을 정확히 평가할 수 없으므로, 다양한 관련성 지표를 가중 평균하여 종합적인 관련성 점수를 계산합니다.
   * 임베딩 유사도, BM25, 태그 매칭, 타이틀 히트를 결합하여 검색 정확도를 향상시킵니다.
   */
  calculateRelevance(input: RelevanceInput): number {
    const { query, content, title, tags, embeddingSimilarity, bm25Result } = input;
    
    // 잘못된 입력으로 인한 오류를 방지하고 안정적인 점수 계산을 보장합니다.
    if (!query || !content) return 0;
    
    // 의미적 유사성을 가장 중요하게 평가하여 사용자의 의도와 가장 가까운 결과를 찾습니다.
    const embeddingScore = embeddingSimilarity 
      ? this.calculateEmbeddingSimilarity(embeddingSimilarity.queryEmbedding, embeddingSimilarity.docEmbedding)
      : 0;
    
    // 키워드 빈도 기반의 전통적인 검색 알고리즘을 활용하여 정확한 키워드 매칭을 보장합니다.
    const bm25Score = bm25Result 
      ? this.normalizeBM25(bm25Result.score)
      : this.calculateSimpleBM25(query, content);
    
    // 사용자가 명시적으로 설정한 태그를 활용하여 메타데이터 기반 관련성을 평가합니다.
    const tagScore = this.calculateTagMatch(query, tags);
    
    // 문서의 제목이 검색어와 일치하는 경우 높은 관련성을 부여하여 정확한 매칭을 우선 제공합니다.
    const titleScore = title ? this.calculateTitleHit(query, title) : 0;
    
    // 각 지표의 중요도에 따라 가중 평균을 적용하여 종합적인 관련성 점수를 계산합니다.
    return 0.60 * embeddingScore + 
           0.30 * bm25Score + 
           0.05 * tagScore + 
           0.05 * titleScore;
  }

  /**
   * 벡터 공간에서의 의미적 유사성을 정량화하여 검색 정확도를 향상시킵니다.
   * 코사인 유사도를 사용하여 벡터의 방향성을 비교하고 크기 차이의 영향을 제거합니다.
   */
  private calculateEmbeddingSimilarity(queryEmbedding: number[], docEmbedding: number[]): number {
    if (queryEmbedding.length !== docEmbedding.length) return 0;
    
    const dotProduct = this.dotProduct(queryEmbedding, docEmbedding);
    const magnitudeA = this.magnitude(queryEmbedding);
    const magnitudeB = this.magnitude(docEmbedding);
    
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    
    const cosine = dotProduct / (magnitudeA * magnitudeB);
    return Math.max(0, cosine); // 음수 유사도를 0으로 제한하여 점수 범위의 일관성을 유지합니다.
  }

  /**
   * BM25 점수를 0-1 범위로 정규화하여 다른 점수 지표와 일관된 비교가 가능하도록 합니다.
   */
  private normalizeBM25(bm25Score: number, kNorm: number = 2.0): number {
    return bm25Score / (bm25Score + kNorm);
  }

  /**
   * 외부 BM25 라이브러리가 없는 경우에도 기본적인 키워드 빈도 기반 검색을 제공합니다.
   * 간소화된 BM25 알고리즘을 구현하여 검색 기능의 안정성을 보장합니다.
   */
  private calculateSimpleBM25(query: string, content: string): number {
    // 잘못된 입력으로 인한 오류를 방지하고 안정적인 점수 계산을 보장합니다.
    if (!query || !content) return 0;
    
    const queryTerms = query.toLowerCase().split(/\s+/);
    const contentTerms = content.toLowerCase().split(/\s+/);
    const termFreq = new Map<string, number>();
    
    // 문서 내 각 용어의 출현 빈도를 계산하여 키워드 매칭 점수를 산출합니다.
    for (const term of contentTerms) {
      termFreq.set(term, (termFreq.get(term) || 0) + 1);
    }
    
    let score = 0;
    const k1 = 1.2;
    const b = 0.75;
    const docLength = contentTerms.length;
    const avgDocLength = 100; // 문서 길이 정규화를 위한 평균값을 사용하여 긴 문서의 불공정한 우위를 방지합니다.
    
    for (const term of queryTerms) {
      const tf = termFreq.get(term) || 0;
      if (tf > 0) {
        const idf = Math.log(2); // 간단한 IDF를 사용하여 희귀 용어에 더 높은 가중치를 부여합니다. (실제 구현에서는 전체 문서 수가 필요)
        const normalizedTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / avgDocLength)));
        score += idf * normalizedTf;
      }
    }
    
    return Math.min(1.0, score / 10); // 점수를 0-1 범위로 정규화하여 다른 지표와 일관된 비교가 가능하도록 합니다.
  }

  /**
   * 검색어와 태그 간의 집합 유사도를 계산하여 메타데이터 기반 관련성을 평가합니다.
   * 자카드 유사도를 사용하여 교집합과 합집합의 비율로 관련성을 정량화합니다.
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
   * 문서 제목이 검색어와 일치하는 정도를 평가하여 정확한 매칭을 우선 제공합니다.
   * 제목은 문서의 핵심 내용을 요약하므로 높은 관련성 지표로 활용합니다.
   */
  private calculateTitleHit(query: string, title: string): number {
    const queryLower = query.toLowerCase();
    const titleLower = title.toLowerCase();
    
    let score = 0;
    
    // 정확한 일치를 최우선으로 평가하여 가장 관련성 높은 결과를 제공합니다.
    if (titleLower === queryLower) score += 1.0;
    // 부분 일치도 일정한 관련성을 인정하여 유연한 검색을 지원합니다.
    else if (titleLower.startsWith(queryLower)) score += 0.5;
    // N-gram 기반 유사 매칭을 통해 오타나 변형된 검색어도 처리합니다.
    else if (this.hasNgramMatch(queryLower, titleLower)) score += 0.2;
    
    return Math.min(1.0, score);
  }

  /**
   * 연속된 문자 시퀀스의 일치 여부를 확인하여 부분 문자열 매칭을 지원합니다.
   * 오타나 변형된 검색어에 대해서도 관련 결과를 찾을 수 있도록 합니다.
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
   * 텍스트를 연속된 N개의 문자로 분할하여 부분 문자열 매칭을 수행합니다.
   * 다양한 길이의 N-gram을 생성하여 유연한 패턴 매칭을 지원합니다.
   */
  private generateNgrams(text: string, n: number): Set<string> {
    const ngrams = new Set<string>();
    for (let i = 0; i <= text.length - n; i++) {
      ngrams.add(text.substring(i, i + n));
    }
    return ngrams;
  }

  /**
   * 두 벡터의 내적을 계산하여 방향성 유사성을 측정합니다.
   * 코사인 유사도 계산의 기초가 되는 연산을 수행합니다.
   */
  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
  }

  /**
   * 벡터의 유클리드 노름을 계산하여 코사인 유사도 계산에 필요한 벡터 크기를 구합니다.
   */
  private magnitude(vector: number[]): number {
    return Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  }

  /**
   * 시간에 따른 기억의 자연스러운 감쇠를 반영하여 최신 정보를 우선 제공합니다.
   * 반감기 기반 지수 감쇠를 사용하여 시간이 지날수록 점수가 감소하도록 설계했습니다.
   */
  calculateRecency(createdAt: Date, type: string): number {
    const ageDays = this.getAgeInDays(createdAt);
    const halfLife = this.getHalfLife(type);
    
    return Math.exp(-Math.log(2) * ageDays / halfLife);
  }

  /**
   * 사용자가 명시적으로 설정한 중요도와 고정 여부를 반영하여 우선순위를 결정합니다.
   * 메모리 타입에 따른 기본 중요도를 적용하여 일관된 점수 체계를 유지합니다.
   */
  calculateImportance(userImportance: number, isPinned: boolean, type: string): number {
    const pinnedBoost = isPinned ? 0.2 : 0;
    const typeBoost = this.getTypeBoost(type);
    
    return Math.max(0, Math.min(1, userImportance + pinnedBoost + typeBoost));
  }

  /**
   * 실제 사용 빈도를 반영하여 자주 참조되는 기억을 우선 제공합니다.
   * 로그 스케일을 사용하여 과도한 사용 빈도가 점수를 지배하지 않도록 균형을 맞춥니다.
   * 인용과 편집에 다른 가중치를 부여하여 사용 패턴의 차이를 반영합니다.
   */
  calculateUsage(metrics: UsageMetrics, batchMin?: number, batchMax?: number): number {
    // 잘못된 입력으로 인한 오류를 방지하고 안정적인 점수 계산을 보장합니다.
    if (!metrics) return 0;
    
    const { viewCount, citeCount, editCount } = metrics;
    
    // 로그 스케일을 사용하여 사용 빈도의 차이를 완화하고 균형잡힌 점수 분포를 생성합니다.
    const rawUsage = Math.log(1 + viewCount) + 
                     2 * Math.log(1 + citeCount) + 
                     0.5 * Math.log(1 + editCount);
    
    // 사용 기록이 없는 경우에도 기본 점수를 부여하여 완전히 배제되지 않도록 합니다.
    if (rawUsage === 0) {
      return 0.1; // 기본 사용성 점수를 제공하여 새로운 기억도 검색 결과에 포함될 수 있도록 합니다.
    }
    
    // 전체 배치의 최소/최대값을 기준으로 정규화하여 상대적 사용성을 정확히 반영합니다.
    if (batchMin !== undefined && batchMax !== undefined) {
      return this.normalize(rawUsage, batchMin, batchMax);
    }
    
    // 배치 정보가 없는 경우 개별적으로 정규화하여 안정적인 점수 범위를 보장합니다.
    return Math.min(1.0, rawUsage / 10);
  }

  /**
   * 여러 메모리의 사용성을 일괄 계산하여 상대적 비교가 가능하도록 합니다.
   * 배치 단위 정규화를 통해 더 정확한 사용성 평가를 수행합니다.
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
   * 값을 0-1 범위로 정규화하여 다른 점수 지표와 일관된 비교가 가능하도록 합니다.
   * 최소/최대값이 같은 경우를 처리하여 안정적인 점수 계산을 보장합니다.
   */
  private normalize(value: number, min: number, max: number, epsilon: number = 1e-6): number {
    if (max === min) return 0.5; // 모든 값이 같을 때 중간값을 반환하여 구분 불가능한 경우를 처리합니다.
    return (value - min) / (max - min + epsilon);
  }

  /**
   * 유사한 내용의 중복 결과를 제거하여 검색 결과의 다양성을 확보합니다.
   * MMR(Maximal Marginal Relevance) 알고리즘을 구현하여 관련성과 다양성의 균형을 맞춥니다.
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
   * 두 텍스트 간의 집합 유사도를 계산하여 중복 여부를 판단합니다.
   * 자카드 유사도를 사용하여 단어 집합의 교집합과 합집합 비율로 유사성을 정량화합니다.
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * 관계 그래프의 신뢰도와 관계 유형을 종합하여 관련성 점수에 반영합니다.
   * 여러 관계의 confidence와 type_boost를 정규화하여 일관된 가중치를 계산합니다.
   * 관계의 개수와 유형에 따라 다른 가중치를 적용하여 정확한 관련성 평가를 수행합니다.
   */
  calculateRelationWeight(
    relations: Array<{ confidence: number; relation_type: string }>,
    maxRelations: number = 5
  ): number {
    if (relations.length === 0) {
      return 0;
    }

    // 관계 유형에 따라 다른 중요도를 부여하여 인과관계나 의존성 같은 중요한 관계를 우선 평가합니다.
    const typeBoostMap: Record<string, number> = {
      'CAUSES': 1.2,
      'DEPENDS_ON': 1.1,
      'FOLLOWS': 1.0,
      'CONTRASTS_WITH': 0.9,
      'REFERENCES': 0.8,
      'BELONGS_TO': 1.0
    };

    // 신뢰도와 관계 유형 부스트를 곱하여 종합적인 관계 가중치를 계산합니다.
    const weightedScores = relations.map(relation => {
      const typeBoost = typeBoostMap[relation.relation_type] || 1.0;
      return relation.confidence * typeBoost;
    });

    // 모든 관계의 가중치를 평균내어 종합적인 관계 점수를 산출합니다.
    const averageScore = weightedScores.reduce((sum, score) => sum + score, 0) / weightedScores.length;

    // 관계 수에 따라 정규화하여 관계가 많은 경우 불공정한 우위를 방지합니다.
    // 실제 관계 수가 최대값보다 적으면 그대로 사용하여 정규화 과소평가를 방지합니다.
    const normalizationFactor = Math.min(relations.length, maxRelations);
    const normalizedScore = averageScore / normalizationFactor;

    // 점수 범위를 0-1로 제한하여 다른 지표와 일관된 비교가 가능하도록 합니다.
    return Math.max(0, Math.min(1, normalizedScore));
  }

  /**
   * 기존 API와의 호환성을 유지하면서 간단한 관련성 계산을 제공합니다.
   * 임베딩이나 BM25가 없는 경우에도 기본적인 텍스트 매칭을 수행합니다.
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
   * 기존 API와의 호환성을 유지하면서 간단한 사용성 계산을 제공합니다.
   * 마지막 접근 시간만을 사용하여 사용 빈도 데이터가 없는 경우에도 평가가 가능하도록 합니다.
   */
  calculateUsageSimple(lastAccessed?: Date): number {
    if (!lastAccessed) return 0.1;
    
    const daysSinceAccess = this.getAgeInDays(lastAccessed);
    return Math.exp(-daysSinceAccess / 30);
  }

  /**
   * 메모리의 생성 시간으로부터 경과된 일수를 계산하여 최근성 평가에 사용합니다.
   */
  private getAgeInDays(date: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - date.getTime();
    return diffTime / (1000 * 60 * 60 * 24);
  }

  /**
   * 메모리 타입에 따라 다른 반감기를 설정하여 타입별 특성에 맞는 감쇠 속도를 적용합니다.
   * working 메모리는 빠르게, semantic 메모리는 천천히 감쇠하도록 설계했습니다.
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
   * 메모리 타입에 따라 기본 중요도를 조정하여 타입별 특성을 반영합니다.
   * semantic 메모리는 높은 중요도를, working 메모리는 낮은 중요도를 부여합니다.
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
