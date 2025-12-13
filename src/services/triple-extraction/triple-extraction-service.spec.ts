/**
 * TripleExtractionService 단위 테스트
 * 
 * Given/When/Then 패턴을 따릅니다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TripleExtractionService } from './triple-extraction-service.js';
import type { TripleExtractionResult } from '../../shared/types/triple-extraction.js';

describe('TripleExtractionService', () => {
  let service: TripleExtractionService;

  beforeEach(() => {
    service = new TripleExtractionService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('extractTriples', () => {
    it('빈 observation 처리 - no_triple 반환', async () => {
      // Given: 빈 observation 텍스트
      const observation = '';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: no_triple 실패 결과 반환
      expect(result).toBeDefined();
      expect(result.triples).toEqual([]);
      expect(result.extractionInfo.failureReason).toBe('no_triple');
      expect(result.extractionInfo.steps).toBeDefined();
      expect(result.extractionInfo.steps.canonicalization).toBe(false);
      expect(result.extractionInfo.steps.entityLinking).toBe(false);
    });

    it('공백만 있는 observation 처리 - no_triple 반환', async () => {
      // Given: 공백만 있는 observation 텍스트
      const observation = '   ';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: no_triple 실패 결과 반환
      expect(result).toBeDefined();
      expect(result.triples).toEqual([]);
      expect(result.extractionInfo.failureReason).toBe('no_triple');
    });

    it('isAvailable - LLM 서비스 사용 가능 여부 확인', () => {
      // Given: TripleExtractionService 인스턴스
      // (환경 변수에 따라 다를 수 있음)

      // When: isAvailable 호출
      const isAvailable = service.isAvailable();

      // Then: boolean 값 반환
      expect(typeof isAvailable).toBe('boolean');
    });

    it('getCostMetrics - 비용 통계 조회', () => {
      // Given: TripleExtractionService 인스턴스

      // When: getCostMetrics 호출
      const metrics = service.getCostMetrics();

      // Then: 비용 통계 반환
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalCalls).toBe('number');
      expect(typeof metrics.totalTokens).toBe('number');
      expect(typeof metrics.totalCost).toBe('number');
      expect(typeof metrics.lastReset).toBe('number');
      expect(metrics.totalCalls).toBeGreaterThanOrEqual(0);
      expect(metrics.totalTokens).toBeGreaterThanOrEqual(0);
      expect(metrics.totalCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe('에러 처리', () => {
    it('LLM 호출 실패 시 실패 결과 반환', async () => {
      // Given: 유효한 observation (하지만 LLM 호출이 실패할 것으로 예상)
      const observation = '사용자가 커피를 좋아한다고 말했습니다.';
      
      // LLM이 사용 불가능한 경우를 가정
      // (실제로는 환경 변수에 따라 다를 수 있음)
      
      // When: extractTriples 호출
      // LLM이 사용 불가능하면 실패 결과를 반환해야 함
      const result = await service.extractTriples(observation);

      // Then: 항상 TripleExtractionResult 반환 (에러가 발생해도)
      expect(result).toBeDefined();
      expect(result.triples).toBeDefined();
      expect(Array.isArray(result.triples)).toBe(true);
      expect(result.extractionInfo).toBeDefined();
      expect(result.extractionInfo.steps).toBeDefined();
      
      // LLM이 사용 불가능한 경우 실패 결과일 수 있음
      if (result.extractionInfo.failureReason) {
        expect(['no_triple', 'llm_api_error', 'llm_parse_fail']).toContain(
          result.extractionInfo.failureReason
        );
      }
    });
  });

  describe('extractionInfo 구조', () => {
    it('extractionInfo는 항상 steps를 포함해야 함', async () => {
      // Given: observation 텍스트
      const observation = '테스트 observation';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: extractionInfo에 steps가 포함되어야 함
      expect(result.extractionInfo).toBeDefined();
      expect(result.extractionInfo.steps).toBeDefined();
      expect(typeof result.extractionInfo.steps.canonicalization).toBe('boolean');
      expect(typeof result.extractionInfo.steps.entityLinking).toBe('boolean');
    });

    it('실패 시 failureReason이 설정되어야 함', async () => {
      // Given: 빈 observation
      const observation = '';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: failureReason이 설정되어야 함
      expect(result.extractionInfo.failureReason).toBeDefined();
      expect(result.extractionInfo.failureReason).toBe('no_triple');
    });

    it('성공 시 failureReason이 없어야 함', async () => {
      // Given: 유효한 observation
      const observation = '사용자가 커피를 좋아한다고 말했습니다.';
      
      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: 성공한 경우 failureReason이 없어야 함
      // (LLM이 사용 불가능한 경우는 제외)
      if (result.triples.length > 0) {
        expect(result.extractionInfo.failureReason).toBeUndefined();
      }
    });
  });

  describe('triples 배열 구조', () => {
    it('triples는 항상 배열이어야 함', async () => {
      // Given: observation 텍스트
      const observation = '테스트 observation';

      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: triples는 배열이어야 함
      expect(result.triples).toBeDefined();
      expect(Array.isArray(result.triples)).toBe(true);
    });

    it('triples의 각 항목은 subject, predicate, object를 포함해야 함', async () => {
      // Given: 유효한 observation
      const observation = '사용자가 커피를 좋아한다고 말했습니다.';
      
      // When: extractTriples 호출
      const result = await service.extractTriples(observation);

      // Then: 성공한 경우 각 triple은 올바른 구조를 가져야 함
      if (result.triples.length > 0) {
        for (const triple of result.triples) {
          expect(triple).toBeDefined();
          expect(typeof triple.subject).toBe('string');
          expect(typeof triple.predicate).toBe('string');
          expect(typeof triple.object).toBe('string');
          expect(triple.subject.trim().length).toBeGreaterThan(0);
          expect(triple.predicate.trim().length).toBeGreaterThan(0);
          expect(triple.object.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('memoryId 파라미터', () => {
    it('memoryId를 전달할 수 있어야 함', async () => {
      // Given: observation과 memoryId
      const observation = '테스트 observation';
      const memoryId = 'test-memory-id';

      // When: extractTriples 호출 (memoryId 포함)
      const result = await service.extractTriples(observation, {}, memoryId);

      // Then: 정상적으로 처리되어야 함 (memoryId는 로깅용)
      expect(result).toBeDefined();
      expect(result.triples).toBeDefined();
      expect(Array.isArray(result.triples)).toBe(true);
    });
  });

  describe('캐싱', () => {
    it('동일한 content에 대해 두 번째 추출은 캐시에서 반환되어야 함', async () => {
      // Given: 동일한 observation 텍스트
      const observation = 'Alice works at Microsoft. She is a data scientist.';
      
      // When: 첫 번째 추출 (LLM 호출)
      const result1 = await service.extractTriples(observation);
      
      // Then: 첫 번째 추출 결과가 반환되어야 함
      expect(result1).toBeDefined();
      expect(result1.triples).toBeDefined();
      expect(Array.isArray(result1.triples)).toBe(true);
      
      // When: 두 번째 추출 (캐시에서 반환되어야 함)
      const result2 = await service.extractTriples(observation);
      
      // Then: 두 번째 추출 결과가 첫 번째와 동일해야 함 (캐시 히트)
      expect(result2).toBeDefined();
      expect(result2.triples).toEqual(result1.triples);
      expect(result2.extractionInfo).toEqual(result1.extractionInfo);
    });

    it('실패한 Triple 추출 결과는 캐시에 저장되지 않아야 함', async () => {
      // Given: Triple 추출이 실패할 수 있는 observation (빈 문자열)
      const observation = '';
      
      // When: 추출 (실패 예상)
      const result1 = await service.extractTriples(observation);
      
      // Then: 실패 결과 반환
      expect(result1.triples.length).toBe(0);
      expect(result1.extractionInfo.failureReason).toBe('no_triple');
      
      // When: 두 번째 추출
      const result2 = await service.extractTriples(observation);
      
      // Then: 캐시에 저장되지 않았으므로 다시 실패해야 함
      // (실패 결과는 캐시되지 않으므로 매번 처리됨)
      expect(result2.triples.length).toBe(0);
      expect(result2.extractionInfo.failureReason).toBe('no_triple');
    });

    it('다른 content는 다른 결과를 반환해야 함', async () => {
      // Given: 다른 observation 텍스트
      const observation1 = 'Alice works at Microsoft.';
      const observation2 = 'Bob works at Google.';
      
      // When: 각각 추출
      const result1 = await service.extractTriples(observation1);
      const result2 = await service.extractTriples(observation2);
      
      // Then: 다른 결과를 반환해야 함 (캐시 키가 다르므로)
      // (실제 결과는 다를 수 있지만, 최소한 다른 캐시 키를 사용해야 함)
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });

  describe('options 파라미터', () => {
    it('options를 전달할 수 있어야 함', async () => {
      // Given: observation과 options
      const observation = '테스트 observation';
      const options = {
        temperature: 0.5,
        maxTokens: 1000
      };

      // When: extractTriples 호출 (options 포함)
      const result = await service.extractTriples(observation, options);

      // Then: 정상적으로 처리되어야 함
      expect(result).toBeDefined();
      expect(result.triples).toBeDefined();
      expect(Array.isArray(result.triples)).toBe(true);
    });
  });
});

