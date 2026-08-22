/**
 * 상위 K개 결과 유지율 계산
 */

import type { SearchResultPair } from './types.js';

/**
 * 상위 K개 결과 유지율 계산
 * 벡터-only 상위 K개가 Consolidation 반영 후에도 상위에 유지되는 비율
 * 
 * Acceptance Criteria:
 * - Top10 유지율 >= 80%
 * - Top5 유지율 >= 90%
 * 
 * @param pair 벡터-only와 Consolidation 반영 후 검색 결과 쌍
 * @param kValues 계산할 K 값 배열 (예: [5, 10])
 * @returns K 값별 유지율 (0 ~ 1)
 * 
 * @example
 * ```typescript
 * const pair = {
 *   vectorOnly: [{ id: 'id1' }, { id: 'id2' }, { id: 'id3' }, ...],
 *   withConsolidation: [{ id: 'id1' }, { id: 'id3' }, { id: 'id2' }, ...]
 * };
 * const retention = calculateTopKRetention(pair, [5, 10]);
 * // retention = { 5: 0.8, 10: 0.7 }
 * ```
 */
export function calculateTopKRetention(
  pair: SearchResultPair,
  kValues: number[] = [5, 10]
): Record<number, number> {
  const retention: Record<number, number> = {};

  for (const k of kValues) {
    // 벡터-only 상위 K개 ID 추출
    const vectorTopK = pair.vectorOnly.slice(0, k).map(r => r.id);
    // Consolidation 반영 후 상위 K개 ID 추출
    const consolidationTopK = pair.withConsolidation.slice(0, k).map(r => r.id);
    const consolidationTopKSet = new Set(consolidationTopK);

    // 교집합 계산: 벡터-only 상위 K개가 Consolidation 상위 K개에도 포함된 개수
    let intersectionCount = 0;
    for (const id of vectorTopK) {
      if (consolidationTopKSet.has(id)) {
        intersectionCount++;
      }
    }

    // 유지율 계산
    // 유지율 = (벡터-only 상위 K개 중 Consolidation 상위 K개에도 포함된 개수) / K
    if (k === 0) {
      retention[k] = 0;
    } else {
      retention[k] = intersectionCount / k;
    }
  }

  return retention;
}
