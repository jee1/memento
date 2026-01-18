/**
 * TripleExtractor 클래스 테스트
 * TDD GREEN 단계: TripleExtractor 클래스 구현 테스트
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TripleExtractor } from '../triple-extractor.js';
import type { TripleExtractionOptions } from '../../../../../shared/types/triple-extraction.js';

describe('TripleExtractor', () => {
  describe('extract 메서드', () => {
    it('Given: 텍스트와 추출 옵션이 제공됨, When: extract 메서드를 호출함, Then: 추출된 Triple 배열과 rawResponse, provider를 반환함', async () => {
      // Given: 텍스트와 추출 옵션이 제공됨
      const text = 'John is a developer.';
      const options: TripleExtractionOptions = {};

      // When: extract 메서드를 호출함
      const extractor = new TripleExtractor();
      const result = await extractor.extract(text, options);

      // Then: 추출된 Triple 배열과 rawResponse, provider를 반환함
      expect(result).toHaveProperty('triples');
      expect(result).toHaveProperty('rawResponse');
      expect(result).toHaveProperty('provider');
      expect(Array.isArray(result.triples)).toBe(true);
      expect(typeof result.rawResponse).toBe('string');
      expect(['openai', 'gemini', 'ollama']).toContain(result.provider);
    });

    it('Given: 텍스트가 제공됨, When: extract 메서드를 호출함, Then: Triple 배열이 반환됨', async () => {
      // Given: 텍스트가 제공됨
      const text = 'Alice works at Google.';

      // When: extract 메서드를 호출함
      const extractor = new TripleExtractor();
      const result = await extractor.extract(text);

      // Then: Triple 배열이 반환됨
      expect(Array.isArray(result.triples)).toBe(true);
      if (result.triples.length > 0) {
        expect(result.triples[0]).toHaveProperty('subject');
        expect(result.triples[0]).toHaveProperty('predicate');
        expect(result.triples[0]).toHaveProperty('object');
      }
    });

    it('Given: 추출 옵션이 제공됨, When: extract 메서드를 호출함, Then: 옵션이 적용된 결과를 반환함', async () => {
      // Given: 추출 옵션이 제공됨
      const text = 'Bob likes programming.';
      const options: TripleExtractionOptions = {
        temperature: 0.5,
        maxTokens: 1000
      };

      // When: extract 메서드를 호출함
      const extractor = new TripleExtractor();
      const result = await extractor.extract(text, options);

      // Then: 옵션이 적용된 결과를 반환함
      expect(result).toHaveProperty('triples');
      expect(result).toHaveProperty('rawResponse');
      expect(result).toHaveProperty('provider');
    });
  });
});
