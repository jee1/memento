/**
 * TripleNormalizer 클래스 테스트
 * TDD RED 단계: TripleNormalizer 클래스 테스트 작성 (구현체 없이 실패해야 함)
 */

import { describe, it, expect } from 'vitest';
import { TripleNormalizer } from '../triple-normalizer.js';
import type { Triple } from '../../../shared/types/triple-extraction.js';

describe('TripleNormalizer', () => {
  describe('normalize 메서드', () => {
    it('Given: Triple 배열이 제공됨, When: normalize 메서드를 호출함, Then: 정규화된 Triple 배열을 반환함', () => {
      // Given: Triple 배열이 제공됨
      const triples: Triple[] = [
        { subject: 'John', predicate: 'is', object: 'developer' },
        { subject: 'Alice', predicate: 'works', object: 'at Google' }
      ];

      // When: normalize 메서드를 호출함
      const normalizer = new TripleNormalizer();
      const result = normalizer.normalize(triples);

      // Then: 정규화된 Triple 배열을 반환함
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(result[0]).toHaveProperty('subject');
      expect(result[0]).toHaveProperty('predicate');
      expect(result[0]).toHaveProperty('object');
    });

    it('Given: 빈 Triple 배열이 제공됨, When: normalize 메서드를 호출함, Then: 빈 배열을 반환함', () => {
      // Given: 빈 Triple 배열이 제공됨
      const triples: Triple[] = [];

      // When: normalize 메서드를 호출함
      const normalizer = new TripleNormalizer();
      const result = normalizer.normalize(triples);

      // Then: 빈 배열을 반환함
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('Given: predicate가 정규화 가능한 Triple 배열이 제공됨, When: normalize 메서드를 호출함, Then: predicate가 정규화된 Triple 배열을 반환함', () => {
      // Given: predicate가 정규화 가능한 Triple 배열이 제공됨
      // '좋아한다'는 '좋아함'으로 정규화됨
      const triples: Triple[] = [
        { subject: 'John', predicate: '좋아한다', object: 'programming' }
      ];

      // When: normalize 메서드를 호출함
      const normalizer = new TripleNormalizer();
      const result = normalizer.normalize(triples);

      // Then: predicate가 정규화된 Triple 배열을 반환함
      expect(result.length).toBe(1);
      expect(result[0].predicate).toBe('좋아함');
      // EntityLinker는 사전에 없는 엔티티를 소문자로 변환함
      expect(result[0].subject).toBe('john');
      expect(result[0].object).toBe('programming');
    });

    it('Given: subject가 정규화 가능한 Triple 배열이 제공됨, When: normalize 메서드를 호출함, Then: subject가 정규화된 Triple 배열을 반환함', () => {
      // Given: subject가 정규화 가능한 Triple 배열이 제공됨
      // 'user'는 '사용자'로 정규화됨
      const triples: Triple[] = [
        { subject: 'user', predicate: 'is', object: 'developer' }
      ];

      // When: normalize 메서드를 호출함
      const normalizer = new TripleNormalizer();
      const result = normalizer.normalize(triples);

      // Then: subject가 정규화된 Triple 배열을 반환함
      expect(result.length).toBe(1);
      expect(result[0].subject).toBe('사용자');
      expect(result[0].predicate).toBe('is');
      expect(result[0].object).toBe('developer');
    });

    it('Given: object가 정규화 가능한 Triple 배열이 제공됨, When: normalize 메서드를 호출함, Then: object가 정규화된 Triple 배열을 반환함', () => {
      // Given: object가 정규화 가능한 Triple 배열이 제공됨
      // 'system'은 '시스템'으로 정규화됨
      const triples: Triple[] = [
        { subject: 'John', predicate: 'works', object: 'system' }
      ];

      // When: normalize 메서드를 호출함
      const normalizer = new TripleNormalizer();
      const result = normalizer.normalize(triples);

      // Then: object가 정규화된 Triple 배열을 반환함
      expect(result.length).toBe(1);
      // EntityLinker는 사전에 없는 엔티티를 소문자로 변환함
      expect(result[0].subject).toBe('john');
      expect(result[0].predicate).toBe('works');
      expect(result[0].object).toBe('시스템');
    });

    it('Given: 모든 필드가 정규화 가능한 Triple 배열이 제공됨, When: normalize 메서드를 호출함, Then: 모든 필드가 정규화된 Triple 배열을 반환함', () => {
      // Given: 모든 필드가 정규화 가능한 Triple 배열이 제공됨
      const triples: Triple[] = [
        { subject: 'user', predicate: '좋아한다', object: 'system' }
      ];

      // When: normalize 메서드를 호출함
      const normalizer = new TripleNormalizer();
      const result = normalizer.normalize(triples);

      // Then: 모든 필드가 정규화된 Triple 배열을 반환함
      expect(result.length).toBe(1);
      expect(result[0].subject).toBe('사용자');
      expect(result[0].predicate).toBe('좋아함');
      expect(result[0].object).toBe('시스템');
    });

    it('Given: 정규화 불가능한 Triple 배열이 제공됨, When: normalize 메서드를 호출함, Then: 기본 정규화가 적용된 Triple 배열을 반환함', () => {
      // Given: 정규화 불가능한 Triple 배열이 제공됨
      const triples: Triple[] = [
        { subject: 'UnknownEntity', predicate: 'unknownPredicate', object: 'UnknownObject' }
      ];

      // When: normalize 메서드를 호출함
      const normalizer = new TripleNormalizer();
      const result = normalizer.normalize(triples);

      // Then: 기본 정규화가 적용된 Triple 배열을 반환함
      expect(result.length).toBe(1);
      // 기본 정규화: 소문자 변환 및 공백 정리
      expect(result[0].subject.toLowerCase()).toBe('unknownentity');
      expect(result[0].predicate).toBe('unknownPredicate'); // predicate는 canonicalizer가 실패하면 원본 유지
      expect(result[0].object.toLowerCase()).toBe('unknownobject');
    });

    it('Given: 여러 Triple이 포함된 배열이 제공됨, When: normalize 메서드를 호출함, Then: 모든 Triple이 정규화된 배열을 반환함', () => {
      // Given: 여러 Triple이 포함된 배열이 제공됨
      const triples: Triple[] = [
        { subject: 'user', predicate: '좋아한다', object: 'programming' },
        { subject: 'system', predicate: '사용함', object: 'user' }
      ];

      // When: normalize 메서드를 호출함
      const normalizer = new TripleNormalizer();
      const result = normalizer.normalize(triples);

      // Then: 모든 Triple이 정규화된 배열을 반환함
      expect(result.length).toBe(2);
      expect(result[0].subject).toBe('사용자');
      expect(result[0].predicate).toBe('좋아함');
      expect(result[1].subject).toBe('시스템');
      expect(result[1].predicate).toBe('사용함');
      expect(result[1].object).toBe('사용자');
    });
  });
});
