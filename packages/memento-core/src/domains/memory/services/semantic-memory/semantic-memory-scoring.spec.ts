import { describe, expect, it } from 'vitest';
import { SemanticMemoryScoring } from './semantic-memory-scoring.js';

describe('SemanticMemoryScoring.tripleToNaturalLanguage (#768)', () => {
  const scoring = new SemanticMemoryScoring();

  it('재조립 가능한 triple은 문장으로 만든다', () => {
    expect(scoring.tripleToNaturalLanguage('시스템', '사용함', '기능')).toBe(
      '시스템은 기능을 사용합니다',
    );
  });

  it('재조립할 수 없으면 원문을 보존한다', () => {
    expect(scoring.tripleToNaturalLanguage('', 'use', '', '오늘 배포 절차를 정리했다')).toBe(
      '오늘 배포 절차를 정리했다',
    );
  });

  it('긴 원문은 잘라서 보존한다', () => {
    const longText = '가'.repeat(600);
    const result = scoring.tripleToNaturalLanguage('시스템', 'use', '기능', longText);
    expect(result).toHaveLength(501);
    expect(result.endsWith('…')).toBe(true);
  });

  it('원문이 없으면 합성 문장 대신 구성 요소를 그대로 남긴다', () => {
    expect(scoring.tripleToNaturalLanguage('시스템', 'use', '기능')).toBe('시스템 · use · 기능');
  });
});
