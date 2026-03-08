/**
 * TripleParser 클래스 테스트
 * TDD RED 단계: TripleParser 클래스 테스트 작성 (구현체 없이 실패해야 함)
 */

import { describe, it, expect } from 'vitest';
import { TripleParser } from '../triple-parser.js';
import type { Triple } from '../../../../../shared/types/triple-extraction.js';

describe('TripleParser', () => {
  describe('parse 메서드', () => {
    it('Given: 유효한 JSON 응답이 제공됨, When: parse 메서드를 호출함, Then: 파싱된 Triple 배열을 반환함', () => {
      // Given: 유효한 JSON 응답이 제공됨
      const responseText = JSON.stringify({
        triples: [
          { subject: 'John', predicate: 'is', object: 'developer' },
          { subject: 'Alice', predicate: 'works', object: 'at Google' }
        ]
      });

      // When: parse 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.parse(responseText);

      // Then: 파싱된 Triple 배열을 반환함
      expect(result.success).toBe(true);
      expect(Array.isArray(result.triples)).toBe(true);
      expect(result.triples.length).toBe(2);
      expect(result.triples[0]).toEqual({
        subject: 'John',
        predicate: 'is',
        object: 'developer'
      });
    });

    it('Given: 마크다운 코드 블록이 포함된 JSON 응답이 제공됨, When: parse 메서드를 호출함, Then: 마크다운을 제거하고 파싱된 Triple 배열을 반환함', () => {
      // Given: 마크다운 코드 블록이 포함된 JSON 응답이 제공됨
      const responseText = '```json\n' + JSON.stringify({
        triples: [
          { subject: 'Bob', predicate: 'likes', object: 'programming' }
        ]
      }) + '\n```';

      // When: parse 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.parse(responseText);

      // Then: 마크다운을 제거하고 파싱된 Triple 배열을 반환함
      expect(result.success).toBe(true);
      expect(result.triples.length).toBe(1);
      expect(result.triples[0].subject).toBe('Bob');
    });

    it('Given: triples 배열이 없는 JSON 응답이 제공됨, When: parse 메서드를 호출함, Then: success가 false이고 errorType이 parse인 결과를 반환함', () => {
      // Given: triples 배열이 없는 JSON 응답이 제공됨
      const responseText = JSON.stringify({ data: 'test' });

      // When: parse 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.parse(responseText);

      // Then: success가 false이고 errorType이 parse인 결과를 반환함
      expect(result.success).toBe(false);
      expect(result.errorType).toBe('parse');
      expect(result.triples.length).toBe(0);
      expect(result.error).toBeDefined();
    });

    it('Given: 유효하지 않은 Triple이 포함된 JSON 응답이 제공됨, When: parse 메서드를 호출함, Then: 유효한 Triple만 반환함', () => {
      // Given: 유효하지 않은 Triple이 포함된 JSON 응답이 제공됨
      const responseText = JSON.stringify({
        triples: [
          { subject: 'John', predicate: 'is', object: 'developer' },
          { subject: '', predicate: 'is', object: 'invalid' }, // 유효하지 않은 Triple
          { subject: 'Alice', predicate: 'works', object: 'at Google' }
        ]
      });

      // When: parse 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.parse(responseText);

      // Then: 유효한 Triple만 반환함
      expect(result.success).toBe(true);
      expect(result.triples.length).toBe(2);
      expect(result.triples[0].subject).toBe('John');
      expect(result.triples[1].subject).toBe('Alice');
    });

    it('Given: 모든 Triple이 유효하지 않은 JSON 응답이 제공됨, When: parse 메서드를 호출함, Then: success가 false이고 errorType이 no_triple인 결과를 반환함', () => {
      // Given: 모든 Triple이 유효하지 않은 JSON 응답이 제공됨
      const responseText = JSON.stringify({
        triples: [
          { subject: '', predicate: 'is', object: 'invalid' },
          { subject: 'Alice', predicate: '', object: 'invalid' }
        ]
      });

      // When: parse 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.parse(responseText);

      // Then: success가 false이고 errorType이 no_triple인 결과를 반환함
      expect(result.success).toBe(false);
      expect(result.errorType).toBe('no_triple');
      expect(result.triples.length).toBe(0);
      expect(result.error).toBeDefined();
    });

    it('Given: 유효하지 않은 JSON 문자열이 제공됨, When: parse 메서드를 호출함, Then: success가 false이고 errorType이 parse인 결과를 반환함', () => {
      // Given: 유효하지 않은 JSON 문자열이 제공됨
      const responseText = 'invalid json {';

      // When: parse 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.parse(responseText);

      // Then: success가 false이고 errorType이 parse인 결과를 반환함
      expect(result.success).toBe(false);
      expect(result.errorType).toBe('parse');
      expect(result.triples.length).toBe(0);
      expect(result.error).toBeDefined();
    });
  });

  describe('extractJSON 메서드', () => {
    it('Given: 순수 JSON 문자열이 제공됨, When: extractJSON 메서드를 호출함, Then: JSON 문자열을 반환함', () => {
      // Given: 순수 JSON 문자열이 제공됨
      const text = '{"triples": []}';

      // When: extractJSON 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.extractJSON(text);

      // Then: JSON 문자열을 반환함
      expect(result).toBe('{"triples": []}');
    });

    it('Given: 마크다운 코드 블록이 포함된 텍스트가 제공됨, When: extractJSON 메서드를 호출함, Then: JSON 부분만 추출하여 반환함', () => {
      // Given: 마크다운 코드 블록이 포함된 텍스트가 제공됨
      const text = '```json\n{"triples": []}\n```';

      // When: extractJSON 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.extractJSON(text);

      // Then: JSON 부분만 추출하여 반환함
      expect(result).toBe('{"triples": []}');
    });

    it('Given: 일반 코드 블록이 포함된 텍스트가 제공됨, When: extractJSON 메서드를 호출함, Then: JSON 부분만 추출하여 반환함', () => {
      // Given: 일반 코드 블록이 포함된 텍스트가 제공됨
      const text = '```\n{"triples": []}\n```';

      // When: extractJSON 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.extractJSON(text);

      // Then: JSON 부분만 추출하여 반환함
      expect(result).toBe('{"triples": []}');
    });

    it('Given: JSON이 포함되지 않은 텍스트가 제공됨, When: extractJSON 메서드를 호출함, Then: null을 반환함', () => {
      // Given: JSON이 포함되지 않은 텍스트가 제공됨
      const text = 'This is not JSON';

      // When: extractJSON 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.extractJSON(text);

      // Then: null을 반환함
      expect(result).toBeNull();
    });

    it('Given: 빈 문자열이 제공됨, When: extractJSON 메서드를 호출함, Then: null을 반환함', () => {
      // Given: 빈 문자열이 제공됨
      const text = '';

      // When: extractJSON 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.extractJSON(text);

      // Then: null을 반환함
      expect(result).toBeNull();
    });
  });

  describe('isValidTriple 메서드', () => {
    it('Given: 유효한 Triple 객체가 제공됨, When: isValidTriple 메서드를 호출함, Then: true를 반환함', () => {
      // Given: 유효한 Triple 객체가 제공됨
      const triple: Triple = {
        subject: 'John',
        predicate: 'is',
        object: 'developer'
      };

      // When: isValidTriple 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.isValidTriple(triple);

      // Then: true를 반환함
      expect(result).toBe(true);
    });

    it('Given: subject가 빈 문자열인 Triple 객체가 제공됨, When: isValidTriple 메서드를 호출함, Then: false를 반환함', () => {
      // Given: subject가 빈 문자열인 Triple 객체가 제공됨
      const triple = {
        subject: '',
        predicate: 'is',
        object: 'developer'
      };

      // When: isValidTriple 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.isValidTriple(triple);

      // Then: false를 반환함
      expect(result).toBe(false);
    });

    it('Given: predicate가 빈 문자열인 Triple 객체가 제공됨, When: isValidTriple 메서드를 호출함, Then: false를 반환함', () => {
      // Given: predicate가 빈 문자열인 Triple 객체가 제공됨
      const triple = {
        subject: 'John',
        predicate: '',
        object: 'developer'
      };

      // When: isValidTriple 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.isValidTriple(triple);

      // Then: false를 반환함
      expect(result).toBe(false);
    });

    it('Given: object가 빈 문자열인 Triple 객체가 제공됨, When: isValidTriple 메서드를 호출함, Then: false를 반환함', () => {
      // Given: object가 빈 문자열인 Triple 객체가 제공됨
      const triple = {
        subject: 'John',
        predicate: 'is',
        object: ''
      };

      // When: isValidTriple 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.isValidTriple(triple);

      // Then: false를 반환함
      expect(result).toBe(false);
    });

    it('Given: 필수 속성이 없는 객체가 제공됨, When: isValidTriple 메서드를 호출함, Then: false를 반환함', () => {
      // Given: 필수 속성이 없는 객체가 제공됨
      const triple = {
        subject: 'John'
        // predicate와 object가 없음
      };

      // When: isValidTriple 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.isValidTriple(triple);

      // Then: false를 반환함
      expect(result).toBe(false);
    });

    it('Given: null이 제공됨, When: isValidTriple 메서드를 호출함, Then: false를 반환함', () => {
      // Given: null이 제공됨
      // When: isValidTriple 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.isValidTriple(null);

      // Then: false를 반환함
      expect(result).toBe(false);
    });

    it('Given: 문자열 타입이 아닌 속성을 가진 Triple 객체가 제공됨, When: isValidTriple 메서드를 호출함, Then: false를 반환함', () => {
      // Given: 문자열 타입이 아닌 속성을 가진 Triple 객체가 제공됨
      const triple = {
        subject: 123, // 숫자 타입
        predicate: 'is',
        object: 'developer'
      };

      // When: isValidTriple 메서드를 호출함
      const parser = new TripleParser();
      const result = parser.isValidTriple(triple);

      // Then: false를 반환함
      expect(result).toBe(false);
    });
  });
});
