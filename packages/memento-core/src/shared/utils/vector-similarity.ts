/**
 * cosine distance → cosine similarity 변환 (issue #713, #806).
 *
 * vec0 테이블은 `distance_metric=cosine`으로 생성되므로 distance는 [0, 2] 범위의 cosine distance다.
 * `1 - distance`는 [-1, 1]이지만 slot threshold(0.8/0.6/0.4)와 랭킹은 [0, 1] 유사도를 가정하므로,
 * 반대 방향(distance 2)은 하한 0으로, 부동소수 오차로 인한 음수 distance는 상한 1로 clamp한다.
 *
 * 이 정의는 저장소 전체에서 유일해야 한다(#806 FR-020). 경로별로 다시 구현하면
 * 방향이 갈라져 임계값·정렬·표시가 경로마다 다르게 동작한다.
 */
import { clamp01 } from './clamp.js';

export function cosineDistanceToSimilarity(distance: number): number {
  if (typeof distance !== 'number' || !Number.isFinite(distance)) {
    return 0;
  }
  return clamp01(1 - distance);
}
