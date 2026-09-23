/**
 * 검색 후보가 질의에 실제로 관련 있는지 판정하는 기각 게이트 포트.
 * 네트워크·설정 없이 순수 타입·판정 함수만 정의한다.
 * #1095
 */

/**
 * 후보 문서마다 "이 문서가 질의에 대한 유효한 맥락이나 답을 담고 있는가"의 확률 P(0~1)를 돌려준다.
 * 반환 배열은 `docs`와 길이와 순서가 같아야 한다.
 * 구현체가 일부 후보를 점수화하지 못하면 그 자리에 `Number.NaN`을 넣는다. 배열을 짧게 반환하면 안 된다.
 */
export interface IRelevanceGatePort {
  score(query: string, docs: string[]): Promise<number[]>;
}

export interface RelevanceGateVerdict {
  /** 질의를 기각해야 하면 true — 호출자는 결과 0건을 반환한다 */
  rejected: boolean;
  /** 후보 점수 중 최댓값. 점수가 하나도 없으면 null */
  topScore: number | null;
  /** 판정에 쓴 임계값 */
  threshold: number;
  /** 점수를 얻지 못한 후보 수 (NaN 개수) */
  unscored: number;
}

/**
 * 2026-09-23 운영 DB 9,470건 실측 기준.
 * 관련 질의 top1 0.230~0.950, 무관 질의 top1 0.010~0.360.
 * T=0.5에서 무관 0/12 통과.
 */
export const DEFAULT_RELEVANCE_GATE_THRESHOLD = 0.5;

/**
 * #1125 게이트가 점수를 하나도 얻지 못했을 때의 정책.
 * 'open'  = 기각하지 않는다 (기본). 게이트 장애가 검색 실패로 번지지 않는다.
 * 'closed'= 기각한다. 무관 질의는 확실히 막히지만 게이트 장애 때 관련 질의도 0건이 된다.
 */
export type RelevanceGateOnError = 'open' | 'closed';

/**
 * 게이트는 질의 단위로만 판정한다. 후보별 필터링은 하지 않는다.
 * 2026-09-23 실측은 top1 기준 질의 단위 기각만 검증했고 후보별 드롭은 미검증이다.
 */
export function judgeRelevanceGate(
  scores: number[],
  threshold: number,
  onError: RelevanceGateOnError = 'open',
): RelevanceGateVerdict {
  const validScores = scores.filter((s) => Number.isFinite(s));
  const unscored = scores.length - validScores.length;

  if (validScores.length === 0) {
    return {
      // #1125 점수를 하나도 못 얻었다. 정책에 따라 통과시키거나 기각한다.
      rejected: onError === 'closed',
      topScore: null,
      threshold,
      unscored,
    };
  }

  const topScore = Math.max(...validScores);

  return {
    rejected: topScore < threshold,
    topScore,
    threshold,
    unscored,
  };
}
