/**
 * Kendall's Tau 순서 일치도 계산
 */

function buildKendallPositionMaps(
  order1: string[],
  order2: string[]
): { position1: Map<string, number>; position2: Map<string, number> } {
  const set1 = new Set(order1);
  const set2 = new Set(order2);
  const position1 = new Map<string, number>();
  const position2 = new Map<string, number>();

  order1.forEach((id, index) => {
    if (set2.has(id)) {
      position1.set(id, index);
    }
  });

  order2.forEach((id, index) => {
    if (set1.has(id)) {
      position2.set(id, index);
    }
  });

  return { position1, position2 };
}

type KendallPairBucket = 'concordant' | 'discordant' | 'tiedX' | 'tiedY' | 'tiedXY';

function tallyKendallPairBucket(sign1: number, sign2: number): KendallPairBucket {
  if (sign1 === 0 && sign2 === 0) {
    return 'tiedXY';
  }
  if (sign1 === 0) {
    return 'tiedX';
  }
  if (sign2 === 0) {
    return 'tiedY';
  }
  if (sign1 === sign2) {
    return 'concordant';
  }
  return 'discordant';
}

function countKendallTauBPairCategories(
  commonIds: string[],
  position1: Map<string, number>,
  position2: Map<string, number>
): { concordant: number; discordant: number; tiedX: number; tiedY: number; tiedXY: number } {
  const tallies = { concordant: 0, discordant: 0, tiedX: 0, tiedY: 0, tiedXY: 0 };
  const n = commonIds.length;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const idI = commonIds[i];
      const idJ = commonIds[j];
      if (idI === undefined || idJ === undefined) {
        continue;
      }

      const pos1I = position1.get(idI);
      const pos1J = position1.get(idJ);
      const pos2I = position2.get(idI);
      const pos2J = position2.get(idJ);
      if (pos1I === undefined || pos1J === undefined || pos2I === undefined || pos2J === undefined) {
        continue;
      }

      const sign1 = pos1I < pos1J ? 1 : pos1I > pos1J ? -1 : 0;
      const sign2 = pos2I < pos2J ? 1 : pos2I > pos2J ? -1 : 0;
      const bucket = tallyKendallPairBucket(sign1, sign2);
      tallies[bucket]++;
    }
  }

  return tallies;
}

function computeKendallTauBFromPairCounts(counts: {
  concordant: number;
  discordant: number;
  tiedX: number;
  tiedY: number;
}): number {
  const { concordant, discordant, tiedX, tiedY } = counts;
  const numerator = concordant - discordant;
  const denominatorX = concordant + discordant + tiedX;
  const denominatorY = concordant + discordant + tiedY;
  const denominator = Math.sqrt(denominatorX * denominatorY);

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Kendall's Tau-b 순서 일치도 계산
 * 두 순서 간의 순위 상관관계를 측정 (-1 ~ 1)
 * 
 * Tau-b는 동점(tie)을 처리하는 버전으로, 검색 결과에서 동일 점수를 가진 항목들을 올바르게 처리합니다.
 * 
 * @param order1 첫 번째 순서 (ID 배열, 점수 순으로 정렬됨)
 * @param order2 두 번째 순서 (ID 배열, 점수 순으로 정렬됨)
 * @returns Kendall's Tau-b 값 (-1 ~ 1)
 *   - 1: 완전히 일치하는 순서
 *   - 0: 무관한 순서
 *   - -1: 완전히 반대인 순서
 * 
 * @example
 * ```typescript
 * const order1 = ['id1', 'id2', 'id3', 'id4'];
 * const order2 = ['id1', 'id3', 'id2', 'id4'];
 * const tau = calculateKendallTau(order1, order2);
 * // tau는 0.67 정도 (부분적으로 일치)
 * ```
 */
export function calculateKendallTau(
  order1: string[],
  order2: string[]
): number {
  if (order1.length === 0 || order2.length === 0) {
    return 0;
  }

  const set2 = new Set(order2);
  const commonIds = order1.filter((id) => set2.has(id));

  if (commonIds.length < 2) {
    return 0;
  }

  const { position1, position2 } = buildKendallPositionMaps(order1, order2);
  const counts = countKendallTauBPairCategories(commonIds, position1, position2);
  return computeKendallTauBFromPairCounts(counts);
}
