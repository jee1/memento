/**
 * 검색 결과의 관련성을 정량적으로 평가하여 사용자에게 가장 유용한 결과를 우선 제공합니다.
 * Memento-Goals.md에 정의된 검증된 랭킹 공식을 구현하여 일관되고 신뢰할 수 있는 검색 품질을 보장합니다.
 *
 * 가중치는 ranking-weights.toml 설정 파일에서 로드하며, 파일이 없으면 constants.ts의 기본값을 사용합니다.
 */

export type {
  BM25Result,
  ConsolidationScoreWeights,
  EmbeddingSimilarity,
  RelevanceInput,
  SearchFeatures,
  SearchProfile,
  SearchRankingWeights,
  UsageMetrics,
} from './search-ranking/search-ranking.types.js';

import type {
  RelevanceInput,
  SearchFeatures,
  SearchProfile,
  SearchRankingWeights,
  UsageMetrics,
} from './search-ranking/search-ranking.types.js';
import {
  calculateFinalScore as computeFinalScore,
  calculateFinalScoreAndBreakdown as computeFinalScoreAndBreakdown,
  calculateFinalScoreWithConsolidation as computeFinalScoreWithConsolidation,
  calculateProceduralMemoryBoost as computeProceduralMemoryBoost,
  getConsolidationScoreWeights as resolveConsolidationScoreWeights,
  resolveSearchRankingWeights,
} from './search-ranking/search-ranking-composite.js';
import {
  calculateRelevance as computeRelevance,
  calculateRelevanceSimple as computeRelevanceSimple,
} from './search-ranking/search-ranking-relevance.js';
import {
  calculateBatchUsage as computeBatchUsage,
  calculateDuplicationPenalty as computeDuplicationPenalty,
  calculateImportance as computeImportance,
  calculateRecency as computeRecency,
  calculateRelationWeight as computeRelationWeight,
  calculateUsage as computeUsage,
  calculateUsageSimple as computeUsageSimple,
} from './search-ranking/search-ranking-signals.js';
import type { ScoreBreakdown } from '../../../shared/types/search.types.js';

export class SearchRanking {
  private readonly weights: SearchRankingWeights;

  constructor(weights?: Partial<SearchRankingWeights>) {
    this.weights = resolveSearchRankingWeights(weights);
  }

  calculateProceduralMemoryBoost(features: SearchFeatures): number {
    return computeProceduralMemoryBoost(features);
  }

  calculateFinalScore(features: SearchFeatures): number {
    return computeFinalScore(features, this.weights);
  }

  calculateFinalScoreAndBreakdown(
    features: SearchFeatures,
    options?: { includeBreakdown?: boolean }
  ): { score: number; breakdown?: ScoreBreakdown } {
    return computeFinalScoreAndBreakdown(features, this.weights, options);
  }

  getConsolidationScoreWeights(profile: SearchProfile = 'balanced') {
    return resolveConsolidationScoreWeights(profile);
  }

  calculateFinalScoreWithConsolidation(
    vectorSimilarity: number,
    consolidationScore: number,
    profile: SearchProfile = 'balanced'
  ): number {
    return computeFinalScoreWithConsolidation(vectorSimilarity, consolidationScore, profile);
  }

  calculateRelevance(input: RelevanceInput): number {
    return computeRelevance(input);
  }

  calculateRecency(createdAt: Date, type: string): number {
    return computeRecency(createdAt, type);
  }

  calculateImportance(userImportance: number, isPinned: boolean, type: string): number {
    return computeImportance(userImportance, isPinned, type);
  }

  calculateUsage(metrics: UsageMetrics, batchMin?: number, batchMax?: number): number {
    return computeUsage(metrics, batchMin, batchMax);
  }

  calculateBatchUsage(metricsList: UsageMetrics[]): { normalized: number[], min: number, max: number } {
    return computeBatchUsage(metricsList);
  }

  calculateDuplicationPenalty(
    candidateContent: string,
    selectedContents: string[]
  ): number {
    return computeDuplicationPenalty(candidateContent, selectedContents);
  }

  calculateRelationWeight(
    relations: Array<{ confidence: number; relation_type: string }>,
    maxRelations: number = 5
  ): number {
    return computeRelationWeight(relations, maxRelations);
  }

  calculateRelevanceSimple(query: string, content: string, tags: string[] = []): number {
    return computeRelevanceSimple(query, content, tags);
  }

  calculateUsageSimple(lastAccessed?: Date): number {
    return computeUsageSimple(lastAccessed);
  }
}
