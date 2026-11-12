/**
 * #1682 memory_injection 항목 필터: 게이트 top-10 점수로 주입 후보를 거른다.
 * recall 응답에는 이 경로를 쓰지 않는다.
 */

import type { RelevanceGateOutcome } from '../../search/index.js';

export type GateItemScore = { id: string; score: number | null };

export type ItemFilterMeta = {
  applied: boolean;
  threshold: number;
  scored: number;
  kept: number;
  dropped: number;
};

export function shouldApplyItemFilter(
  itemScoreMin: number | undefined,
  rejectionGate: RelevanceGateOutcome | undefined,
): boolean {
  if (itemScoreMin === undefined || itemScoreMin <= 0) {
    return false;
  }
  if (!rejectionGate || rejectionGate.verdict !== 'passed') {
    return false;
  }
  return true;
}

/**
 * 점수 없는 항목(top-10 밖, null/NaN)과 임계 미만은 탈락.
 * score === threshold 는 남긴다.
 */
export function filterByGateItemScores<T extends { id: string }>(
  memories: T[],
  gateItemScores: GateItemScore[] | undefined,
  threshold: number,
): { memories: T[]; scored: number; kept: number; dropped: number } {
  const scoreById = new Map<string, number>();
  for (const entry of gateItemScores ?? []) {
    if (entry.score !== null && Number.isFinite(entry.score)) {
      scoreById.set(entry.id, entry.score);
    }
  }

  const keptMemories: T[] = [];
  let scored = 0;
  for (const memory of memories) {
    const score = scoreById.get(memory.id);
    if (score === undefined) {
      continue;
    }
    scored += 1;
    if (score >= threshold) {
      keptMemories.push(memory);
    }
  }

  return {
    memories: keptMemories,
    scored,
    kept: keptMemories.length,
    dropped: memories.length - keptMemories.length,
  };
}

export function buildItemFilterMeta<T extends { id: string }>(input: {
  itemScoreMin: number | undefined;
  rejectionGate: RelevanceGateOutcome | undefined;
  memoriesBefore: T[];
  gateItemScores: GateItemScore[] | undefined;
}): { memories: T[]; itemFilter: ItemFilterMeta } {
  const threshold = input.itemScoreMin ?? 0;
  const applied = shouldApplyItemFilter(input.itemScoreMin, input.rejectionGate);
  if (!applied) {
    return {
      memories: input.memoriesBefore,
      itemFilter: {
        applied: false,
        threshold,
        scored: 0,
        kept: input.memoriesBefore.length,
        dropped: 0,
      },
    };
  }

  const filtered = filterByGateItemScores(
    input.memoriesBefore,
    input.gateItemScores,
    threshold,
  );
  return {
    memories: filtered.memories,
    itemFilter: {
      applied: true,
      threshold,
      scored: filtered.scored,
      kept: filtered.kept,
      dropped: filtered.dropped,
    },
  };
}
