/**
 * triple-chunk-merge 단위 테스트
 */

import { describe, it, expect } from 'vitest';
import { mergeTripleLists } from './triple-chunk-merge.js';
import type { Triple } from '../../../../shared/types/triple-extraction.js';

describe('mergeTripleLists', () => {
  it('두 청크에 동일한 트리플이 있으면 출력은 하나뿐이다', () => {
    const t1: Triple = { subject: 'Alice', predicate: 'knows', object: 'Bob' };
    const t2: Triple = { subject: 'alice', predicate: 'KNOWS', object: 'bob' };

    const out = mergeTripleLists([[t1], [t2]]);

    expect(out).toHaveLength(1);
    expect(out[0]).toBe(t1);
  });

  it('외부 배열 순서가 바뀌면 전역 flatten 순서 기준으로 먼저 나온 트리플이 유지된다', () => {
    const first: Triple = { subject: 'S', predicate: 'P', object: 'O' };
    const dup: Triple = { subject: 's', predicate: 'p', object: 'o' };

    const aFirst = mergeTripleLists([[first], [dup]]);
    expect(aFirst).toHaveLength(1);
    expect(aFirst[0]).toBe(first);

    const bFirst = mergeTripleLists([[dup], [first]]);
    expect(bFirst).toHaveLength(1);
    expect(bFirst[0]).toBe(dup);
  });

  it('빈 내부 배열·빈 외부 배열은 빈 결과를 만든다', () => {
    const t: Triple = { subject: 'x', predicate: 'y', object: 'z' };

    expect(mergeTripleLists([])).toEqual([]);
    expect(mergeTripleLists([[], []])).toEqual([]);
    expect(mergeTripleLists([[], [t]])).toEqual([t]);
  });
});
