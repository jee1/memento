/**
 * 검색 랭킹 개별 신호(recency, importance, usage 등) 계산
 */

import type { UsageMetrics } from './search-ranking.types.js';
import { SEARCH_RANKING } from '../../../../shared/config/constants.js';
import { daysBetween } from '../../../../shared/utils/date.js';

/**
 * recency 반감기(일). 텍스트 레인과 융합 레인이 이 값 하나만 쓴다 (#1178).
 * 타입별 반감기는 타입 사전확률을 한 번 더 얹어 incident/ops 정답(episodic)을 밀어낸다. 타입 가산은 getTypeBoost 가 importance 에서 맡는다.
 */
export const RECENCY_HALF_LIFE_DAYS = 30;

/**
 * 시간에 따른 기억의 자연스러운 감쇠를 반영하여 최신 정보를 우선 제공합니다.
 * 반감기 기반 지수 감쇠를 사용하여 시간이 지날수록 점수가 감소하도록 설계했습니다.
 */
export function calculateRecency(createdAt: Date): number {
  const ageDays = daysBetween(new Date(), createdAt);

  return Math.exp(-Math.log(2) * ageDays / RECENCY_HALF_LIFE_DAYS);
}

/**
 * Ranking input boundary: absent, null, and non-finite values share one default (#1082).
 * Explicit `0` is preserved.
 */
export function resolveUserImportanceForRanking(value: unknown, fallback = 0.5): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

/**
 * 사용자가 명시적으로 설정한 중요도와 고정 여부를 반영하여 우선순위를 결정합니다.
 * 메모리 타입에 따른 기본 중요도를 적용하여 일관된 점수 체계를 유지합니다.
 */
export function calculateImportance(userImportance: number, isPinned: boolean, type: string): number {
  const pinnedBoost = isPinned ? 0.2 : 0;
  const typeBoost = getTypeBoost(type);

  return Math.max(0, Math.min(1, userImportance + pinnedBoost + typeBoost));
}

/**
 * Compresses the importance signal toward 0.5 so γ·importance does not dominate relevance (#1082).
 * `scale=1` preserves raw; `scale=0` flattens to neutral 0.5 (diagnostic upper bound only).
 */
export function applyImportanceSignalScale(rawImportance: number, scale: number): number {
  const clamped = Math.max(0, Math.min(1, rawImportance));
  const s = Math.max(0, Math.min(1, scale));
  return Math.max(0, Math.min(1, 0.5 + (clamped - 0.5) * s));
}

/**
 * Compresses the recency signal toward 0.5 so beta*recency does not outrank alpha*relevance (#1175).
 * `scale=1` preserves raw; `scale=0` flattens to neutral 0.5 (diagnostic upper bound only).
 */
export function applyRecencySignalScale(rawRecency: number, scale: number): number {
  const clamped = Math.max(0, Math.min(1, rawRecency));
  const s = Math.max(0, Math.min(1, scale));
  return Math.max(0, Math.min(1, 0.5 + (clamped - 0.5) * s));
}

/**
 * Rescales the fusion relevance signal around 0.5 so alpha*relevance is not outweighed by the
 * query-independent priors (#1180). Unlike the importance and recency scales this one allows
 * `scale > 1`: fusion relevance never reaches 0 for irrelevant documents (measured floor ~0.43 on
 * the production corpus), so its realized spread is narrower than beta*recency + gamma*importance.
 * `scale=1` preserves raw; `scale=0` flattens to neutral 0.5 (diagnostic lower bound only).
 */
export function applyRelevanceSignalScale(rawRelevance: number, scale: number): number {
  const clamped = Math.max(0, Math.min(1, rawRelevance));
  const s = Math.max(0, Math.min(SEARCH_RANKING.RELEVANCE_SIGNAL_SCALE_MAX, scale));
  return Math.max(0, Math.min(1, 0.5 + (clamped - 0.5) * s));
}

/**
 * 실제 사용 빈도를 반영하여 자주 참조되는 기억을 우선 제공합니다.
 * 로그 스케일을 사용하여 과도한 사용 빈도가 점수를 지배하지 않도록 균형을 맞춥니다.
 * 인용과 편집에 다른 가중치를 부여하여 사용 패턴의 차이를 반영합니다.
 */
export function calculateUsage(metrics: UsageMetrics, batchMin?: number, batchMax?: number): number {
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
    return normalize(rawUsage, batchMin, batchMax);
  }

  // 배치 정보가 없는 경우 개별적으로 정규화하여 안정적인 점수 범위를 보장합니다.
  return Math.min(1.0, rawUsage / 10);
}

/**
 * 여러 메모리의 사용성을 일괄 계산하여 상대적 비교가 가능하도록 합니다.
 * 배치 단위 정규화를 통해 더 정확한 사용성 평가를 수행합니다.
 */
export function calculateBatchUsage(metricsList: UsageMetrics[]): { normalized: number[], min: number, max: number } {
  const rawUsages = metricsList.map(metrics => {
    const { viewCount, citeCount, editCount } = metrics;
    return Math.log(1 + viewCount) +
           2 * Math.log(1 + citeCount) +
           0.5 * Math.log(1 + editCount);
  });

  const min = Math.min(...rawUsages);
  const max = Math.max(...rawUsages);

  const normalized = rawUsages.map(usage =>
    normalize(usage, min, max)
  );

  return { normalized, min, max };
}

/**
 * 유사한 내용의 중복 결과를 제거하여 검색 결과의 다양성을 확보합니다.
 * MMR(Maximal Marginal Relevance) 알고리즘을 구현하여 관련성과 다양성의 균형을 맞춥니다.
 */
export function calculateDuplicationPenalty(
  candidateContent: string,
  selectedContents: string[]
): number {
  if (selectedContents.length === 0) return 0;

  let maxSimilarity = 0;

  for (const selectedContent of selectedContents) {
    const similarity = calculateTextSimilarity(candidateContent, selectedContent);
    maxSimilarity = Math.max(maxSimilarity, similarity);
  }

  return maxSimilarity;
}

/**
 * 관계 그래프의 신뢰도와 관계 유형을 종합하여 관련성 점수에 반영합니다.
 * 여러 관계의 confidence와 type_boost를 정규화하여 일관된 가중치를 계산합니다.
 * 관계의 개수와 유형에 따라 다른 가중치를 적용하여 정확한 관련성 평가를 수행합니다.
 */
export function calculateRelationWeight(
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

  // 관계 수를 maxRelations 까지 커버리지 비율로 반영한다. 관계가 많을수록 단조 증가하고 maxRelations 이상은 평균에 포화한다 (#1185).
  // 이전 식(평균 ÷ min(n, maxRelations))은 평균을 관계 수로 한 번 더 나눠 관계가 적을수록 커졌다.
  const coverage = Math.min(relations.length, maxRelations) / maxRelations;
  const normalizedScore = averageScore * coverage;

  // 점수 범위를 0-1로 제한하여 다른 지표와 일관된 비교가 가능하도록 합니다.
  return Math.max(0, Math.min(1, normalizedScore));
}

/**
 * 기존 API와의 호환성을 유지하면서 간단한 사용성 계산을 제공합니다.
 * 마지막 접근 시간만을 사용하여 사용 빈도 데이터가 없는 경우에도 평가가 가능하도록 합니다.
 */
export function calculateUsageSimple(lastAccessed?: Date): number {
  if (!lastAccessed) return 0.1;

  const daysSinceAccess = daysBetween(new Date(), lastAccessed);
  return Math.exp(-daysSinceAccess / 30);
}

/**
 * 값을 0-1 범위로 정규화하여 다른 점수 지표와 일관된 비교가 가능하도록 합니다.
 * 최소/최대값이 같은 경우를 처리하여 안정적인 점수 계산을 보장합니다.
 */
function normalize(value: number, min: number, max: number, epsilon: number = 1e-6): number {
  if (max === min) return 0.5; // 모든 값이 같을 때 중간값을 반환하여 구분 불가능한 경우를 처리합니다.
  return (value - min) / (max - min + epsilon);
}

/**
 * 두 텍스트 간의 집합 유사도를 계산하여 중복 여부를 판단합니다.
 * 자카드 유사도를 사용하여 단어 집합의 교집합과 합집합 비율로 유사성을 정량화합니다.
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * 메모리 타입에 따라 기본 중요도를 조정하여 타입별 특성을 반영합니다.
 * semantic 메모리는 높은 중요도를, working 메모리는 낮은 중요도를 부여합니다.
 */
function getTypeBoost(type: string): number {
  switch (type) {
    case 'semantic': return 0.1;
    case 'episodic': return 0.0;
    case 'working': return -0.05;
    case 'procedural': return 0.05;
    default: return 0.0;
  }
}
