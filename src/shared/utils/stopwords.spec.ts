/**
 * Stopwords 테스트
 * 불용어 유틸리티 테스트
 */

import { describe, it, expect } from 'vitest';
import {
  getStopWords,
  getEnglishStopWords,
  getKoreanStopWords,
  isStopWord
} from './stopwords.js';

describe('stopwords', () => {
  describe('getStopWords', () => {
    it('영어와 한국어 불용어를 모두 포함해야 함', () => {
      // When: 모든 불용어 가져오기
      const stopWords = getStopWords();

      // Then: 영어와 한국어 불용어가 모두 포함되어야 함
      expect(stopWords.has('the')).toBe(true); // 영어
      expect(stopWords.has('이')).toBe(true); // 한국어
      expect(stopWords.has('가')).toBe(true); // 한국어
    });

    it('Set을 반환해야 함', () => {
      // When: 불용어 가져오기
      const stopWords = getStopWords();

      // Then: Set 타입이어야 함
      expect(stopWords).toBeInstanceOf(Set);
    });

    it('모든 단어가 소문자로 변환되어야 함', () => {
      // When: 불용어 가져오기
      const stopWords = getStopWords();

      // Then: 대문자도 소문자로 변환되어 있어야 함
      expect(stopWords.has('the')).toBe(true);
      expect(stopWords.has('THE')).toBe(false); // 대문자는 없어야 함
      expect(stopWords.has('The')).toBe(false); // 대소문자 혼합도 없어야 함
    });
  });

  describe('getEnglishStopWords', () => {
    it('영어 불용어만 포함해야 함', () => {
      // When: 영어 불용어 가져오기
      const englishStopWords = getEnglishStopWords();

      // Then: 영어 불용어가 포함되어야 함
      expect(englishStopWords.has('the')).toBe(true);
      expect(englishStopWords.has('a')).toBe(true);
      expect(englishStopWords.has('an')).toBe(true);
      expect(englishStopWords.has('and')).toBe(true);
      expect(englishStopWords.has('or')).toBe(true);
    });

    it('한국어 불용어는 포함하지 않아야 함', () => {
      // When: 영어 불용어 가져오기
      const englishStopWords = getEnglishStopWords();

      // Then: 한국어 불용어가 포함되지 않아야 함
      expect(englishStopWords.has('이')).toBe(false);
      expect(englishStopWords.has('가')).toBe(false);
      expect(englishStopWords.has('을')).toBe(false);
    });

    it('Set을 반환해야 함', () => {
      // When: 영어 불용어 가져오기
      const englishStopWords = getEnglishStopWords();

      // Then: Set 타입이어야 함
      expect(englishStopWords).toBeInstanceOf(Set);
    });

    it('모든 단어가 소문자로 변환되어야 함', () => {
      // When: 영어 불용어 가져오기
      const englishStopWords = getEnglishStopWords();

      // Then: 대문자도 소문자로 변환되어 있어야 함
      expect(englishStopWords.has('the')).toBe(true);
      expect(englishStopWords.has('THE')).toBe(false);
    });
  });

  describe('getKoreanStopWords', () => {
    it('한국어 불용어만 포함해야 함', () => {
      // When: 한국어 불용어 가져오기
      const koreanStopWords = getKoreanStopWords();

      // Then: 한국어 불용어가 포함되어야 함
      expect(koreanStopWords.has('이')).toBe(true);
      expect(koreanStopWords.has('가')).toBe(true);
      expect(koreanStopWords.has('을')).toBe(true);
      expect(koreanStopWords.has('를')).toBe(true);
      expect(koreanStopWords.has('에')).toBe(true);
    });

    it('영어 불용어는 포함하지 않아야 함', () => {
      // When: 한국어 불용어 가져오기
      const koreanStopWords = getKoreanStopWords();

      // Then: 영어 불용어가 포함되지 않아야 함
      expect(koreanStopWords.has('the')).toBe(false);
      expect(koreanStopWords.has('a')).toBe(false);
      expect(koreanStopWords.has('an')).toBe(false);
    });

    it('Set을 반환해야 함', () => {
      // When: 한국어 불용어 가져오기
      const koreanStopWords = getKoreanStopWords();

      // Then: Set 타입이어야 함
      expect(koreanStopWords).toBeInstanceOf(Set);
    });

    it('모든 단어가 소문자로 변환되어야 함', () => {
      // When: 한국어 불용어 가져오기
      const koreanStopWords = getKoreanStopWords();

      // Then: 대문자도 소문자로 변환되어 있어야 함
      expect(koreanStopWords.has('이')).toBe(true);
      // 한국어는 대소문자 구분이 없지만, 일관성을 위해 소문자로 변환
    });
  });

  describe('isStopWord', () => {
    it('영어 불용어를 인식해야 함', () => {
      // When: 영어 불용어 확인
      const result1 = isStopWord('the');
      const result2 = isStopWord('a');
      const result3 = isStopWord('and');

      // Then: true 반환
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });

    it('한국어 불용어를 인식해야 함', () => {
      // When: 한국어 불용어 확인
      const result1 = isStopWord('이');
      const result2 = isStopWord('가');
      const result3 = isStopWord('을');

      // Then: true 반환
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });

    it('대소문자를 구분하지 않아야 함', () => {
      // When: 대문자 불용어 확인
      const result1 = isStopWord('THE');
      const result2 = isStopWord('The');
      const result3 = isStopWord('tHe');

      // Then: 모두 true 반환
      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
    });

    it('불용어가 아닌 단어는 false를 반환해야 함', () => {
      // When: 일반 단어 확인
      const result1 = isStopWord('hello');
      const result2 = isStopWord('world');
      const result3 = isStopWord('test');
      const result4 = isStopWord('안녕');

      // Then: false 반환
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
      expect(result4).toBe(false);
    });

    it('빈 문자열은 false를 반환해야 함', () => {
      // When: 빈 문자열 확인
      const result = isStopWord('');

      // Then: false 반환
      expect(result).toBe(false);
    });

    it('공백만 있는 문자열은 false를 반환해야 함', () => {
      // When: 공백 문자열 확인
      const result = isStopWord('   ');

      // Then: false 반환
      expect(result).toBe(false);
    });
  });

  describe('통합 테스트', () => {
    it('getStopWords와 isStopWord가 일관성 있게 동작해야 함', () => {
      // Given: 모든 불용어 가져오기
      const stopWords = getStopWords();

      // When: isStopWord로 확인
      const testWords = ['the', '이', '가', 'hello', 'world'];

      // Then: 일관성 있게 동작해야 함
      testWords.forEach(word => {
        const isStop = isStopWord(word);
        const inSet = stopWords.has(word.toLowerCase());
        expect(isStop).toBe(inSet);
      });
    });

    it('영어와 한국어 불용어의 합집합이 getStopWords와 일치해야 함', () => {
      // Given: 각 언어별 불용어 가져오기
      const englishStopWords = getEnglishStopWords();
      const koreanStopWords = getKoreanStopWords();
      const allStopWords = getStopWords();

      // When: 합집합 확인
      const union = new Set([...englishStopWords, ...koreanStopWords]);

      // Then: getStopWords와 일치해야 함
      expect(union.size).toBe(allStopWords.size);
      union.forEach(word => {
        expect(allStopWords.has(word)).toBe(true);
      });
    });
  });
});

