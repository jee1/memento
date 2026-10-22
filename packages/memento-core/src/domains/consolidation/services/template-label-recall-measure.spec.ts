import { describe, expect, it } from 'vitest';
import {
  jaccardTokens,
  meanReciprocalRank,
  parseTemplateFields,
  rankOfSelf,
  stripTemplate,
  summarizePairwiseJaccard,
} from './template-label-recall-measure.js';

function record(decision: string, rationale: string): string {
  return [
    `결정: ${decision}`,
    `근거: ${rationale}`,
    '버린 대안: 다른 저장소',
    '안 통한 것: 없음',
    '다음 걸림돌: 배포 창',
  ].join('\n');
}

describe('template label recall measure (#1445)', () => {
  it('parses dashed and plain labels and drops a row that misses one', () => {
    const parsed = parseTemplateFields(record('컬럼을 추가한다', 'regex 가 대시를 놓친다'));
    expect(parsed?.결정).toBe('컬럼을 추가한다');
    expect(parseTemplateFields('- 결정: 하나만')).toBeNull();
  });

  it('raises jaccard between unrelated records when labels stay in the text', () => {
    const labeled = [
      record('컬럼을 추가한다', 'regex 가 대시를 놓친다'),
      record('훅을 저장소로 옮긴다', '문구가 세 호스트에 갈라져 있다'),
    ];
    const stripped = labeled.map(stripTemplate);
    expect(jaccardTokens(labeled[0], labeled[1])).toBeGreaterThan(jaccardTokens(stripped[0], stripped[1]));
    const withLabels = summarizePairwiseJaccard(labeled);
    const withoutLabels = summarizePairwiseJaccard(stripped);
    expect(withLabels.mean).toBeGreaterThan(withoutLabels.mean);
  });

  it('ranks the matching vector first', () => {
    const documents = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    expect(rankOfSelf([1, 0, 0], documents, 0)).toBe(1);
    expect(rankOfSelf([0, 1, 0], documents, 1)).toBe(1);
    expect(meanReciprocalRank([1, 2])).toBeCloseTo(0.75);
  });
});
