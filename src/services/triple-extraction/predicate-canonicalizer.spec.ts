/**
 * PredicateCanonicalizer 단위 테스트
 * 
 * Given/When/Then 패턴을 따릅니다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PredicateCanonicalizer } from './predicate-canonicalizer.js';
import type { PredicateCanonicalizationResult } from '../../shared/types/triple-extraction.js';

describe('PredicateCanonicalizer', () => {
  let canonicalizer: PredicateCanonicalizer;

  beforeEach(() => {
    canonicalizer = new PredicateCanonicalizer();
  });

  describe('canonicalize', () => {
    describe('성공 케이스 - 동의어가 표준 predicate로 변환', () => {
      it('좋아함 관련 동의어 정규화', () => {
        // Given: 다양한 "좋아함" 동의어
        const synonyms = ['좋아한다', '선호한다', '선호함', '좋아함', '선호', 'like', 'prefer', 'favorite'];

        // When: canonicalize 호출
        const results = synonyms.map(synonym => canonicalizer.canonicalize(synonym));

        // Then: 모두 "좋아함"으로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.canonical).toBe('좋아함');
          expect(result.original).toBe(synonyms.find(s => s === result.original));
        }
      });

      it('사용함 관련 동의어 정규화', () => {
        // Given: 다양한 "사용함" 동의어
        const synonyms = ['사용한다', '사용함', '활용한다', '활용함', '쓰다', 'use', 'utilize'];

        // When: canonicalize 호출
        const results = synonyms.map(synonym => canonicalizer.canonicalize(synonym));

        // Then: 모두 "사용함"으로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.canonical).toBe('사용함');
        }
      });

      it('생성함 관련 동의어 정규화', () => {
        // Given: 다양한 "생성함" 동의어
        const synonyms = ['만든다', '생성한다', '생성함', '만들다', 'create', 'generate', 'make'];

        // When: canonicalize 호출
        const results = synonyms.map(synonym => canonicalizer.canonicalize(synonym));

        // Then: 모두 "생성함"으로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.canonical).toBe('생성함');
        }
      });

      it('업데이트함 관련 동의어 정규화', () => {
        // Given: 다양한 "업데이트함" 동의어
        const synonyms = ['업데이트한다', '업데이트함', '수정한다', '수정함', '변경한다', '변경함', 'update', 'modify', 'change'];

        // When: canonicalize 호출
        const results = synonyms.map(synonym => canonicalizer.canonicalize(synonym));

        // Then: 모두 "업데이트함"으로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.canonical).toBe('업데이트함');
        }
      });

      it('소유함 관련 동의어 정규화', () => {
        // Given: 다양한 "소유함" 동의어
        const synonyms = ['소유한다', '소유함', '가지고 있다', 'has', 'own', 'possess'];

        // When: canonicalize 호출
        const results = synonyms.map(synonym => canonicalizer.canonicalize(synonym));

        // Then: 모두 "소유함"으로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.canonical).toBe('소유함');
        }
      });

      it('일치함 관련 동의어 정규화', () => {
        // Given: 다양한 "일치함" 동의어
        const synonyms = ['일치한다', '일치함', '같다', '동일하다', 'match', 'equal', 'same'];

        // When: canonicalize 호출
        const results = synonyms.map(synonym => canonicalizer.canonicalize(synonym));

        // Then: 모두 "일치함"으로 정규화되어야 함
        for (const result of results) {
          expect(result.success).toBe(true);
          expect(result.canonical).toBe('일치함');
        }
      });

      it('표준 predicate 자체는 그대로 반환', () => {
        // Given: 표준 predicate
        const standardPredicate = '좋아함';

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(standardPredicate);

        // Then: 그대로 반환되어야 함
        expect(result.success).toBe(true);
        expect(result.canonical).toBe('좋아함');
        expect(result.original).toBe('좋아함');
        expect(result.synonym).toBeUndefined(); // 동의어가 아니므로
      });
    });

    describe('실패 케이스 - 매칭되지 않는 predicate', () => {
      it('사전에 없는 predicate는 원본 반환', () => {
        // Given: 사전에 없는 predicate
        const unknownPredicate = '알수없는동사';

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(unknownPredicate);

        // Then: 정규화 실패, 원본 반환
        expect(result.success).toBe(false);
        expect(result.canonical).toBe(unknownPredicate);
        expect(result.original).toBe(unknownPredicate);
        expect(result.synonym).toBeUndefined();
      });

      it('빈 문자열 처리', () => {
        // Given: 빈 문자열
        const emptyPredicate = '';

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(emptyPredicate);

        // Then: 정규화 실패
        expect(result.success).toBe(false);
        expect(result.canonical).toBe('');
        expect(result.original).toBe('');
      });

      it('공백만 있는 문자열 처리', () => {
        // Given: 공백만 있는 문자열
        const whitespacePredicate = '   ';

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(whitespacePredicate);

        // Then: 정규화 실패
        expect(result.success).toBe(false);
        expect(result.canonical).toBe('');
        expect(result.original).toBe(whitespacePredicate);
      });

      it('null 처리', () => {
        // Given: null
        const nullPredicate = null as unknown as string;

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(nullPredicate);

        // Then: 정규화 실패
        expect(result.success).toBe(false);
        expect(result.canonical).toBe('');
        expect(result.original).toBe('');
      });

      it('undefined 처리', () => {
        // Given: undefined
        const undefinedPredicate = undefined as unknown as string;

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(undefinedPredicate);

        // Then: 정규화 실패
        expect(result.success).toBe(false);
        expect(result.canonical).toBe('');
        expect(result.original).toBe('');
      });
    });

    describe('대소문자 및 공백 처리', () => {
      it('대소문자 구분 없이 정규화', () => {
        // Given: 대소문자가 다른 동의어
        const testCases = [
          { input: 'LIKE', expected: '좋아함' },
          { input: 'Like', expected: '좋아함' },
          { input: 'like', expected: '좋아함' }
        ];

        // When: canonicalize 호출
        for (const testCase of testCases) {
          const result = canonicalizer.canonicalize(testCase.input);

          // Then: 정규화 성공
          expect(result.success).toBe(true);
          expect(result.canonical).toBe(testCase.expected);
        }
      });

      it('앞뒤 공백 제거 후 정규화', () => {
        // Given: 공백이 있는 동의어
        const synonymWithSpaces = '  좋아한다  ';

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(synonymWithSpaces);

        // Then: 공백 제거 후 정규화 성공
        expect(result.success).toBe(true);
        expect(result.canonical).toBe('좋아함');
        expect(result.original).toBe('좋아한다'); // 공백 제거된 원본
      });
    });

    describe('결과 구조 검증', () => {
      it('성공 시 결과 구조 검증', () => {
        // Given: 동의어
        const synonym = '좋아한다';

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(synonym);

        // Then: 올바른 결과 구조
        expect(result).toBeDefined();
        expect(typeof result.canonical).toBe('string');
        expect(typeof result.original).toBe('string');
        expect(typeof result.success).toBe('boolean');
        expect(result.success).toBe(true);
        expect(result.canonical).toBe('좋아함');
        expect(result.original).toBe('좋아한다');
        // synonym는 동의어가 원본과 다를 때만 존재
        if (result.canonical !== result.original) {
          expect(result.synonym).toBeDefined();
        }
      });

      it('실패 시 결과 구조 검증', () => {
        // Given: 사전에 없는 predicate
        const unknownPredicate = '알수없는동사';

        // When: canonicalize 호출
        const result = canonicalizer.canonicalize(unknownPredicate);

        // Then: 올바른 결과 구조
        expect(result).toBeDefined();
        expect(typeof result.canonical).toBe('string');
        expect(typeof result.original).toBe('string');
        expect(typeof result.success).toBe('boolean');
        expect(result.success).toBe(false);
        expect(result.canonical).toBe(unknownPredicate);
        expect(result.original).toBe(unknownPredicate);
        expect(result.synonym).toBeUndefined();
      });
    });
  });

  describe('canonicalizeBatch', () => {
    it('여러 predicate 일괄 정규화', () => {
      // Given: 여러 predicate 배열
      const predicates = ['좋아한다', '사용함', '생성함', '알수없는동사'];

      // When: canonicalizeBatch 호출
      const results = canonicalizer.canonicalizeBatch(predicates);

      // Then: 각 predicate가 정규화되어야 함
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(predicates.length);

      // 첫 번째: 좋아함으로 정규화
      expect(results[0].success).toBe(true);
      expect(results[0].canonical).toBe('좋아함');

      // 두 번째: 사용함으로 정규화
      expect(results[1].success).toBe(true);
      expect(results[1].canonical).toBe('사용함');

      // 세 번째: 생성함으로 정규화
      expect(results[2].success).toBe(true);
      expect(results[2].canonical).toBe('생성함');

      // 네 번째: 정규화 실패
      expect(results[3].success).toBe(false);
      expect(results[3].canonical).toBe('알수없는동사');
    });

    it('빈 배열 처리', () => {
      // Given: 빈 배열
      const predicates: string[] = [];

      // When: canonicalizeBatch 호출
      const results = canonicalizer.canonicalizeBatch(predicates);

      // Then: 빈 배열 반환
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('혼합 케이스 처리 (성공/실패 혼합)', () => {
      // Given: 성공/실패가 혼합된 predicate 배열
      const predicates = ['좋아한다', '알수없는동사', '사용함', '', 'update'];

      // When: canonicalizeBatch 호출
      const results = canonicalizer.canonicalizeBatch(predicates);

      // Then: 각각 올바르게 처리되어야 함
      expect(results.length).toBe(predicates.length);
      expect(results[0].success).toBe(true); // 좋아함
      expect(results[1].success).toBe(false); // 알수없는동사
      expect(results[2].success).toBe(true); // 사용함
      expect(results[3].success).toBe(false); // 빈 문자열
      expect(results[4].success).toBe(true); // 업데이트함
    });
  });
});

