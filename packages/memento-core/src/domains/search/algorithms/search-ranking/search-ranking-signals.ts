/**
 * 검색 랭킹 개별 신호(recency, importance, usage 등) 계산
 */

import { SEARCH_RANKING } from '../../../../shared/config/constants.js';
import { daysBetween } from '../../../../shared/utils/date.js';

/**
 * recency 반감기(일). 텍스트 레인과 융합 레인이 이 값 하나만 쓴다 (#1178).
 * 타입별 반감기는 타입 사전확률을 한 번 더 얹어 incident/ops 정답(episodic)을 밀어낸다. 타입 가산은 getTypeBoost 가 importance 에서 맡는다.
 */
const RECENCY_HALF_LIFE_DAYS = 30;

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
