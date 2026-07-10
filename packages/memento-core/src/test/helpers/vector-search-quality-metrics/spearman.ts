/**
 * Spearman's Rho 순서 일치도 계산
 */

/**
 * Spearman's Rho 순서 일치도 계산
 * 두 순서 간의 순위 상관관계를 측정 (-1 ~ 1)
 * 
 * Spearman's Rho는 순위 차이를 기반으로 계산되며, Kendall's Tau와 함께 사용하여
 * 순서 보존 정도를 다각도로 검증할 수 있습니다.
 * 
 * @param order1 첫 번째 순서 (ID 배열, 점수 순으로 정렬됨)
 * @param order2 두 번째 순서 (ID 배열, 점수 순으로 정렬됨)
 * @returns Spearman's Rho 값 (-1 ~ 1)
 *   - 1: 완전히 일치하는 순서
 *   - 0: 무관한 순서
 *   - -1: 완전히 반대인 순서
 * 
 * @example
 * ```typescript
 * const order1 = ['id1', 'id2', 'id3', 'id4'];
 * const order2 = ['id1', 'id3', 'id2', 'id4'];
 * const rho = calculateSpearmanRho(order1, order2);
 * // rho는 0.8 정도 (대체로 일치)
 * ```
 */
export function calculateSpearmanRho(
  order1: string[],
  order2: string[]
): number {
  // 빈 배열 처리
  if (order1.length === 0 || order2.length === 0) {
    return 0;
  }

  // 두 순서에서 공통 ID만 추출
  const set1 = new Set(order1);
  const set2 = new Set(order2);
  const commonIds = order1.filter(id => set2.has(id));

  if (commonIds.length < 2) {
    // 공통 ID가 2개 미만이면 순서 비교 불가
    return 0;
  }

  // 각 ID의 순위를 계산 (동점 처리 포함)
  const rank1 = calculateRanks(order1, commonIds);
  const rank2 = calculateRanks(order2, commonIds);

  // 순위 차이의 제곱합 계산
  let sumSquaredDiff = 0;
  for (const id of commonIds) {
    const diff = rank1.get(id)! - rank2.get(id)!;
    sumSquaredDiff += diff * diff;
  }

  // Spearman's Rho 계산
  // Rho = 1 - (6 * sum(d^2)) / (n * (n^2 - 1))
  const n = commonIds.length;
  const denominator = n * (n * n - 1);

  if (denominator === 0) {
    return 0;
  }

  return 1 - (6 * sumSquaredDiff) / denominator;
}

/**
 * 순위 계산 헬퍼 함수
 * 각 ID의 위치를 순위로 사용 (1-based)
 * 
 * 동점 처리는 실제 점수를 비교해야 하지만, 여기서는 위치 기반으로 순위를 계산합니다.
 * 실제 점수 정보가 필요한 경우, SearchResult의 score 필드를 사용하여
 * 동점인 항목들에 평균 순위를 할당할 수 있습니다.
 * 
 * @param order 순서 (ID 배열, 점수 순으로 정렬됨)
 * @param targetIds 순위를 계산할 ID 목록 (공통 ID)
 * @returns ID별 순위 맵 (1-based)
 */
function calculateRanks(
  order: string[],
  targetIds: string[]
): Map<string, number> {
  const ranks = new Map<string, number>();
  const targetSet = new Set(targetIds);

  // 각 ID의 위치를 순위로 사용 (1-based)
  order.forEach((id, index) => {
    if (targetSet.has(id)) {
      ranks.set(id, index + 1); // 1-based 순위
    }
  });

  // targetIds에 있지만 order에 없는 ID는 마지막 순위로 처리
  for (const id of targetIds) {
    if (!ranks.has(id)) {
      ranks.set(id, order.length + 1);
    }
  }

  return ranks;
}
