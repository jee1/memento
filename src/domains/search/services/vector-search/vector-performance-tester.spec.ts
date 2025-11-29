/**
 * 벡터 성능 테스터 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorPerformanceTester } from './vector-performance-tester';
import type { VectorPerformanceRepository } from '../../../../../shared/interfaces/database.interface';
import type { PerformanceTestResult } from '../../../../../shared/types/vector-search.types';

// Mock 리포지토리 생성
const createMockPerformanceRepository = (): any => ({
  runPerformanceTest: vi.fn()
});

describe('VectorPerformanceTester', () => {
  let tester: VectorPerformanceTester;
  let mockRepository: any;

  beforeEach(() => {
    mockRepository = createMockPerformanceRepository();
    tester = new VectorPerformanceTester(mockRepository);
  });

  describe('runPerformanceTest', () => {
    it('should run performance test successfully', async () => {
      // Given
      const queryVector = new Array(384).fill(0.1);
      const iterations = 5;
      const expectedResult: PerformanceTestResult = {
        averageTime: 25.5,
        minTime: 20,
        maxTime: 30,
        results: 10,
        successRate: 1.0
      };

      mockRepository.runPerformanceTest.mockResolvedValue(expectedResult);

      // When
      const result = await tester.runPerformanceTest(queryVector, iterations);

      // Then
      expect(result).toEqual(expectedResult);
      expect(mockRepository.runPerformanceTest).toHaveBeenCalledWith(queryVector, iterations);
    });

    it('should throw error for invalid vector dimensions', async () => {
      // Given
      const queryVector = new Array(1000).fill(0.1); // 잘못된 차원
      const iterations = 5;

      // When & Then
      await expect(tester.runPerformanceTest(queryVector, iterations))
        .rejects.toThrow('벡터 차원 불일치');
    });

    it('should throw error for invalid iterations', async () => {
      // Given
      const queryVector = new Array(384).fill(0.1);
      const iterations = 150; // 잘못된 반복 횟수

      // When & Then
      await expect(tester.runPerformanceTest(queryVector, iterations))
        .rejects.toThrow('반복 횟수는 1-100 사이여야 합니다');
    });

    it('should handle repository errors gracefully', async () => {
      // Given
      const queryVector = new Array(384).fill(0.1);
      const iterations = 5;

      mockRepository.runPerformanceTest.mockRejectedValue(new Error('Test failed'));

      // When
      const result = await tester.runPerformanceTest(queryVector, iterations);

      // Then
      expect(result).toEqual({
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        results: 0,
        successRate: 0
      });
    });
  });

  describe('analyzeResults', () => {
    it('should analyze excellent performance', () => {
      // Given
      const result: PerformanceTestResult = {
        averageTime: 5,
        minTime: 3,
        maxTime: 7,
        results: 10,
        successRate: 1.0
      };

      // When
      const analysis = tester.analyzeResults(result);

      // Then
      expect(analysis.performance).toBe('excellent');
      expect(analysis.recommendations).toHaveLength(0);
    });

    it('should analyze good performance', () => {
      // Given
      const result: PerformanceTestResult = {
        averageTime: 25,
        minTime: 20,
        maxTime: 30,
        results: 10,
        successRate: 1.0
      };

      // When
      const analysis = tester.analyzeResults(result);

      // Then
      expect(analysis.performance).toBe('good');
      expect(analysis.recommendations).toHaveLength(0);
    });

    it('should analyze fair performance with recommendations', () => {
      // Given
      const result: PerformanceTestResult = {
        averageTime: 75,
        minTime: 70,
        maxTime: 80,
        results: 10,
        successRate: 1.0
      };

      // When
      const analysis = tester.analyzeResults(result);

      // Then
      expect(analysis.performance).toBe('fair');
      expect(analysis.recommendations).toContain('인덱스 최적화를 고려하세요');
    });

    it('should analyze poor performance with multiple recommendations', () => {
      // Given
      const result: PerformanceTestResult = {
        averageTime: 150,
        minTime: 140,
        maxTime: 160,
        results: 10,
        successRate: 1.0
      };

      // When
      const analysis = tester.analyzeResults(result);

      // Then
      expect(analysis.performance).toBe('poor');
      expect(analysis.recommendations).toContain('인덱스 재구성이 필요합니다');
      expect(analysis.recommendations).toContain('데이터베이스 성능 튜닝을 고려하세요');
    });

    it('should recommend system stability check for low success rate', () => {
      // Given
      const result: PerformanceTestResult = {
        averageTime: 25,
        minTime: 20,
        maxTime: 30,
        results: 10,
        successRate: 0.8
      };

      // When
      const analysis = tester.analyzeResults(result);

      // Then
      expect(analysis.recommendations).toContain('시스템 안정성 검토가 필요합니다');
    });
  });

  describe('generateReport', () => {
    it('should generate performance report', () => {
      // Given
      const result: PerformanceTestResult = {
        averageTime: 25.5,
        minTime: 20,
        maxTime: 30,
        results: 10,
        successRate: 1.0
      };

      // When
      const report = tester.generateReport(result);

      // Then
      expect(report).toContain('벡터 검색 성능 테스트 리포트');
      expect(report).toContain('평균 응답 시간: 25.50ms');
      expect(report).toContain('최소 응답 시간: 20ms');
      expect(report).toContain('최대 응답 시간: 30ms');
      expect(report).toContain('검색 결과 수: 10개');
      expect(report).toContain('성공률: 100.0%');
      expect(report).toContain('성능 등급: GOOD');
    });
  });
});
