/**
 * 표시 계약 회귀 검증 (#806).
 *
 * 이 결합기는 코드 변경 대상이 아니다. 이미 절대 기준 임계값으로 문구를 고르고 있었고
 * 입력이 재조정된 점수였을 뿐이다. min-max 제거로 입력이 절대값이 되면 자동으로 의미를 갖는다.
 */
import { describe, expect, it } from 'vitest';
import { SearchResultCombiner } from './search-result-combiner.js';

function vectorHit(id: string, similarity: number) {
  return {
    id,
    content: `content-${id}`,
    type: 'episodic',
    importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z',
    last_accessed: '2026-08-29T00:00:00.000Z',
    pinned: false,
    tags: [],
    similarity,
  };
}

function textHit(id: string, score: number) {
  return {
    id,
    content: `content-${id}`,
    type: 'episodic',
    importance: 0.5,
    created_at: '2026-08-29T00:00:00.000Z',
    last_accessed: '2026-08-29T00:00:00.000Z',
    pinned: 0,
    tags: [],
    score,
  };
}

describe('SearchResultCombiner 표시 계약 (#806)', () => {
  const combiner = new SearchResultCombiner();

  it('SC-005: 표시 숫자가 점수 필드와 일치한다', () => {
    const out = combiner.combine([], [vectorHit('a', 0.4321) as never], 0.4, 0.6);
    const hit = out.find((r) => r.id === 'a')!;
    expect(hit.recall_reason).toContain(hit.vectorScore.toFixed(3));
  });

  it('SC-013: 낮은 절대 유사도에는 "의미적 유사도 높음"이 붙지 않는다', () => {
    const out = combiner.combine([textHit('a', 0.2)] as never, [vectorHit('a', 0.25) as never], 0.4, 0.6);
    expect(out[0]!.recall_reason).not.toContain('의미적 유사도 높음');
  });

  it('FR-018: 높은 절대 유사도에는 문구가 붙는다', () => {
    const out = combiner.combine([textHit('a', 0.2)] as never, [vectorHit('a', 0.92) as never], 0.4, 0.6);
    expect(out[0]!.recall_reason).toContain('의미적 유사도 높음');
  });
});
