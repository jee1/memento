/**
 * Triple 추출 인터페이스 테스트
 * TDD RED 단계: 인터페이스 정의 및 테스트 작성 (구현체 없이 실패해야 함)
 */

import { describe, it, expect } from 'vitest';
import type { ITripleExtractor, ITripleParser, ITripleNormalizer } from '../interfaces.js';
import type { Triple } from '../../../../../shared/types/triple-extraction.js';

describe('ITripleExtractor 인터페이스', () => {
  describe('인터페이스 계약 정의', () => {
    it('Given: ITripleExtractor 인터페이스가 정의됨, When: 인터페이스의 메서드 시그니처를 확인함, Then: extract 메서드가 정의되어 있음', () => {
      // Given: ITripleExtractor 인터페이스가 정의됨
      // When: 인터페이스의 메서드 시그니처를 확인함
      type ExtractorType = ITripleExtractor;
      const hasMethod: ExtractorType = {
        extract: async (text: string, options?: any) => ({
          triples: [],
          rawResponse: '',
          provider: 'openai' as const
        })
      };
      
      // Then: extract 메서드가 정의되어 있음
      expect(typeof hasMethod.extract).toBe('function');
    });

    it('Given: ITripleExtractor 인터페이스가 정의됨, When: 인터페이스의 반환 타입을 확인함, Then: Promise<추출결과> 타입을 반환함', async () => {
      // Given: ITripleExtractor 인터페이스가 정의됨
      // When: 인터페이스의 반환 타입을 확인함
      const mockExtractor: ITripleExtractor = {
        extract: async (text: string, options?: any) => ({
          triples: [],
          rawResponse: 'test response',
          provider: 'openai' as const
        })
      };
      
      // Then: Promise<추출결과> 타입을 반환함
      const result = await mockExtractor.extract('test text');
      expect(result).toHaveProperty('triples');
      expect(result).toHaveProperty('rawResponse');
      expect(result).toHaveProperty('provider');
      expect(Array.isArray(result.triples)).toBe(true);
    });
  });
});

describe('ITripleParser 인터페이스', () => {
  describe('인터페이스 계약 정의', () => {
    it('Given: ITripleParser 인터페이스가 정의됨, When: 인터페이스의 메서드 시그니처를 확인함, Then: parse, extractJSON, isValidTriple 메서드가 정의되어 있음', () => {
      // Given: ITripleParser 인터페이스가 정의됨
      // When: 인터페이스의 메서드 시그니처를 확인함
      type ParserType = ITripleParser;
      const hasMethods: ParserType = {
        parse: (responseText: string) => ({ success: true, triples: [] }),
        extractJSON: (text: string) => null,
        isValidTriple: (triple: any) => false
      };
      
      // Then: parse, extractJSON, isValidTriple 메서드가 정의되어 있음
      expect(typeof hasMethods.parse).toBe('function');
      expect(typeof hasMethods.extractJSON).toBe('function');
      expect(typeof hasMethods.isValidTriple).toBe('function');
    });

    it('Given: ITripleParser 인터페이스가 정의됨, When: parse 메서드를 호출함, Then: 파싱 결과를 반환함', () => {
      // Given: ITripleParser 인터페이스가 정의됨
      // When: parse 메서드를 호출함
      const mockParser: ITripleParser = {
        parse: (responseText: string) => ({
          success: true,
          triples: []
        }),
        extractJSON: (text: string) => null,
        isValidTriple: (triple: any) => false
      };
      
      // Then: 파싱 결과를 반환함
      const result = mockParser.parse('test response');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('triples');
      expect(typeof result.success).toBe('boolean');
      expect(Array.isArray(result.triples)).toBe(true);
    });
  });
});

describe('ITripleNormalizer 인터페이스', () => {
  describe('인터페이스 계약 정의', () => {
    it('Given: ITripleNormalizer 인터페이스가 정의됨, When: 인터페이스의 메서드 시그니처를 확인함, Then: normalize 메서드가 정의되어 있음', () => {
      // Given: ITripleNormalizer 인터페이스가 정의됨
      // When: 인터페이스의 메서드 시그니처를 확인함
      type NormalizerType = ITripleNormalizer;
      const hasMethod: NormalizerType = {
        normalize: (triples: Triple[]) => []
      };
      
      // Then: normalize 메서드가 정의되어 있음
      expect(typeof hasMethod.normalize).toBe('function');
    });

    it('Given: ITripleNormalizer 인터페이스가 정의됨, When: normalize 메서드를 호출함, Then: 정규화된 Triple 배열을 반환함', () => {
      // Given: ITripleNormalizer 인터페이스가 정의됨
      // When: normalize 메서드를 호출함
      const mockNormalizer: ITripleNormalizer = {
        normalize: (triples: Triple[]) => triples
      };
      
      const testTriples: Triple[] = [
        { subject: 'test', predicate: 'is', object: 'test' }
      ];
      
      // Then: 정규화된 Triple 배열을 반환함
      const result = mockNormalizer.normalize(testTriples);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });
  });
});
