/**
 * 검색 랭킹 복합 점수 계산 및 가중치 해석
 */

import { getRankingWeights } from '../../../../shared/config/ranking-weights-loader.js';
import { SEARCH_RANKING } from '../../../../shared/config/constants.js';
import type { ScoreBreakdown } from '../../../../shared/types/search.types.js';
import type {
  SearchFeatures,
  SearchRankingWeights,
} from './search-ranking.types.js';

/**
 * 설정 파일과 기본값에서 SearchRanking 가중치를 해석합니다.
 */
export function resolveSearchRankingWeights(weights?: Partial<SearchRankingWeights>): SearchRankingWeights {
  const configWeights = getRankingWeights();
  const defaultWeights = SEARCH_RANKING.DEFAULT_WEIGHTS;

  return {
    relevance: configWeights.ranking_weights.alpha ?? defaultWeights.relevance,
    recency: configWeights.ranking_weights.beta ?? defaultWeights.recency,
    importance: configWeights.ranking_weights.gamma ?? defaultWeights.importance,
    usage: configWeights.ranking_weights.delta ?? defaultWeights.usage,
    duplication_penalty: configWeights.ranking_weights.epsilon ?? defaultWeights.duplication_penalty,
    process_attribute_fit: configWeights.ranking_weights.theta ?? defaultWeights.process_attribute_fit,
    zeta_fb: configWeights.ranking_weights.zeta_fb ?? defaultWeights.zeta_fb,
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
export function calculateProceduralMemoryBoost(features: SearchFeatures): number {
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
 * Procedural Memory 특화 가중치가 제공되면 최종 점수에 부스트를 추가합니다.
 */
export function calculateFinalScore(features: SearchFeatures, weights: SearchRankingWeights): number {
  const relevanceScore = features.relevance;

  const zetaFb = weights.zeta_fb ?? SEARCH_RANKING.DEFAULT_WEIGHTS.zeta_fb ?? 0.05;
  const feedbackNorm = features.feedback_score ?? 0.5;
  // 피드백 없음(0.5)일 때 항 기여 0 — 전역 점수·임계값을 밀어 올리지 않음
  const feedbackTerm = zetaFb * (feedbackNorm - 0.5);

  const finalScore = weights.relevance * relevanceScore +
                    weights.recency * features.recency +
                    weights.importance * features.importance +
                    weights.usage * features.usage -
                    weights.duplication_penalty * features.duplication_penalty +
                    feedbackTerm;

  const proceduralBoost = calculateProceduralMemoryBoost(features);
  const processFitWeight = weights.process_attribute_fit ?? 0;
  const processFit =
    features.process_attribute_fit !== undefined
      ? processFitWeight * features.process_attribute_fit
      : 0;
  return finalScore + proceduralBoost + processFit;
}

/**
 * 최종 점수와 (옵션) 점수 구성 요소. breakdown은 include_score_breakdown 경로에서만 계산.
 *
 * FR-008 6슬롯 고정: `breakdown.relevance`의 score·pct는 순수 α·relevance(블렌딩 후)만이 아니라,
 * 동일 슬롯에 procedural_boost·process_attribute_fit 기여까지 합산한다
 * (`ScoreBreakdown.relevance`, `contracts/mcp-tools.md` §1 `relevance` 슬롯).
 */
export function calculateFinalScoreAndBreakdown(
  features: SearchFeatures,
  weights: SearchRankingWeights,
  options?: { includeBreakdown?: boolean }
): { score: number; breakdown?: ScoreBreakdown } {
  const score = calculateFinalScore(features, weights);
  if (!options?.includeBreakdown) {
    return { score };
  }

  const relevanceScore = features.relevance;

  const w = weights;
  const zetaFb = w.zeta_fb ?? SEARCH_RANKING.DEFAULT_WEIGHTS.zeta_fb ?? 0.05;
  const feedbackNorm = features.feedback_score ?? 0.5;

  const cRel = w.relevance * relevanceScore;
  const cRec = w.recency * features.recency;
  const cImp = w.importance * features.importance;
  const cUsage = w.usage * features.usage;
  const cDup = -w.duplication_penalty * features.duplication_penalty;
  const cFb = zetaFb * (feedbackNorm - 0.5);

  const proceduralBoost = calculateProceduralMemoryBoost(features);
  const processFitWeight = w.process_attribute_fit ?? 0;
  const processFit =
    features.process_attribute_fit !== undefined
      ? processFitWeight * features.process_attribute_fit
      : 0;

  /** FR-008 6슬롯: 절차·process_fit은 별도 필드 없이 relevance 슬롯에 합산(spec 004). */
  const relevanceBucket = cRel + proceduralBoost + processFit;
  /** FR-008: 각 항 기여값을 최종 점수(|total|) 대비 백분율로 표시; `pct`는 계약상 정수(반올림, contracts §1). */
  const totalAbs = Math.abs(score) < 1e-12 ? 1e-12 : Math.abs(score);
  const pct = (x: number): number => Math.round((100 * x) / totalAbs);

  const breakdown: ScoreBreakdown = {
    relevance: { score: relevanceBucket, pct: pct(relevanceBucket) },
    recency: { score: cRec, pct: pct(cRec) },
    importance: { score: cImp, pct: pct(cImp) },
    usage: { score: cUsage, pct: pct(cUsage) },
    feedback: { score: cFb, pct: pct(cFb) },
    duplication_penalty: { score: cDup, pct: pct(cDup) },
    total: score
  };

  return { score, breakdown };
}
