/**
 * 리팩토링된 간격 반복 알고리즘 테스트
 * 기존 인터페이스와의 호환성 검증
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  SpacedRepetitionAlgorithmRefactored,
  createSpacedRepetitionAlgorithm,
  getSpacedRepetitionAlgorithm,
  resetSpacedRepetitionAlgorithm
} from '../spaced-repetition-refactored.js';
import type { SpacedRepetitionFeatures, SpacedRepetitionWeights } from '../../../../shared/types/spaced-repetition.types.js';

// 컨테이너 Mock
vi.mock('../services/spaced-repetition/spaced-repetition-container.js', () => ({
  getSpacedRepetitionService: vi.fn(),
  initializeSpacedRepetitionWithDefaults: vi.fn(),
  resetSpacedRepetition: vi.fn()
}));

describe('SpacedRepetitionAlgorithmRefactored', () => {
  let algorithm: SpacedRepetitionAlgorithmRefactored;
  let mockService: any;
  let testFeatures: SpacedRepetitionFeatures;

  beforeEach(async () => {
    // Mock 서비스 설정
    mockService = {
      calculateNextInterval: vi.fn(),
      calculateRecallProbability: vi.fn(),
      needsReview: vi.fn(),
      createReviewSchedule: vi.fn(),
      createBatchReviewSchedules: vi.fn(),
      calculateReviewPriority: vi.fn(),
      analyzeReviewPerformance: vi.fn(),
      recommendOptimalInterval: vi.fn()
    };

    const { getSpacedRepetitionService } = await import('../services/spaced-repetition/spaced-repetition-container.js');
    getSpacedRepetitionService.mockReturnValue(mockService);

    algorithm = new SpacedRepetitionAlgorithmRefactored();
    
    testFeatures = {
      importance: 0.8,
      usage: 0.6,
      helpful_feedback: 0.7,
      bad_feedback: 0.2
    };
  });

  describe('기본 기능 테스트', () => {
    it('should calculate next interval', () => {
      mockService.calculateNextInterval.mockReturnValue(10);
      
      const result = algorithm.calculateNextInterval(7, testFeatures);
      
      expect(mockService.calculateNextInterval).toHaveBeenCalledWith(7, testFeatures);
      expect(result).toBe(10);
    });

    it('should calculate recall probability', () => {
      mockService.calculateRecallProbability.mockReturnValue(0.8);
      
      const result = algorithm.calculateRecallProbability(5, 7);
      
      expect(mockService.calculateRecallProbability).toHaveBeenCalledWith(5, 7);
      expect(result).toBe(0.8);
    });

    it('should check if review is needed', () => {
      mockService.needsReview.mockReturnValue(true);
      
      const result = algorithm.needsReview(5, 7, 0.7);
      
      expect(mockService.needsReview).toHaveBeenCalledWith(5, 7, 0.7);
      expect(result).toBe(true);
    });

    it('should create review schedule', () => {
      const mockSchedule = {
        memory_id: 'test-1',
        current_interval: 10,
        next_review: new Date('2024-01-15'),
        recall_probability: 0.8,
        needs_review: true,
        multiplier: 1.4
      };
      
      mockService.createReviewSchedule.mockReturnValue(mockSchedule);
      
      const result = algorithm.createReviewSchedule(
        'test-1',
        7,
        new Date('2024-01-01'),
        testFeatures
      );
      
      expect(mockService.createReviewSchedule).toHaveBeenCalledWith(
        'test-1',
        7,
        new Date('2024-01-01'),
        testFeatures
      );
      expect(result).toEqual(mockSchedule);
    });

    it('should create batch review schedules', () => {
      const mockSchedules = [
        { memory_id: 'test-1', current_interval: 10 },
        { memory_id: 'test-2', current_interval: 12 }
      ];
      
      mockService.createBatchReviewSchedules.mockReturnValue(mockSchedules);
      
      const memories = [
        { id: 'test-1', current_interval: 7, last_review: new Date(), importance: 0.8, usage: 0.6, helpful_feedback: 0.7, bad_feedback: 0.2 },
        { id: 'test-2', current_interval: 7, last_review: new Date(), importance: 0.9, usage: 0.7, helpful_feedback: 0.8, bad_feedback: 0.1 }
      ];
      
      const result = algorithm.createBatchReviewSchedules(memories);
      
      expect(mockService.createBatchReviewSchedules).toHaveBeenCalledWith(memories);
      expect(result).toEqual(mockSchedules);
    });

    it('should calculate review priority', () => {
      mockService.calculateReviewPriority.mockReturnValue(0.85);
      
      const schedule = {
        memory_id: 'test-1',
        current_interval: 10,
        recall_probability: 0.7
      };
      
      const result = algorithm.calculateReviewPriority(schedule);
      
      expect(mockService.calculateReviewPriority).toHaveBeenCalledWith(schedule);
      expect(result).toBe(0.85);
    });

    it('should analyze review performance', () => {
      const mockPerformance = {
        totalMemories: 10,
        reviewedMemories: 8,
        averageRecallRate: 0.75,
        performanceByInterval: new Map()
      };
      
      mockService.analyzeReviewPerformance.mockReturnValue(mockPerformance);
      
      const schedules = [{ memory_id: 'test-1' }];
      const actualRecall = new Map([['test-1', true]]);
      
      const result = algorithm.analyzeReviewPerformance(schedules, actualRecall);
      
      expect(mockService.analyzeReviewPerformance).toHaveBeenCalledWith(schedules, actualRecall);
      expect(result).toEqual(mockPerformance);
    });

    it('should recommend optimal interval', () => {
      mockService.recommendOptimalInterval.mockReturnValue(14);
      
      const recallHistory = [true, true, false, true, true];
      
      const result = algorithm.recommendOptimalInterval(7, recallHistory, testFeatures);
      
      expect(mockService.recommendOptimalInterval).toHaveBeenCalledWith(7, recallHistory, testFeatures);
      expect(result).toBe(14);
    });
  });

  describe('팩토리 함수 테스트', () => {
    it('should create algorithm with custom weights', () => {
      const customWeights: Partial<SpacedRepetitionWeights> = {
        importance: 0.7,
        usage: 0.3
      };
      
      const customAlgorithm = createSpacedRepetitionAlgorithm(customWeights);
      
      expect(customAlgorithm).toBeInstanceOf(SpacedRepetitionAlgorithmRefactored);
    });

    it('should get default algorithm', () => {
      const defaultAlgorithm = getSpacedRepetitionAlgorithm();
      
      expect(defaultAlgorithm).toBeInstanceOf(SpacedRepetitionAlgorithmRefactored);
    });

    it('should reset algorithm', async () => {
      expect(() => resetSpacedRepetitionAlgorithm()).not.toThrow();
    });
  });

  describe('에러 처리 테스트', () => {
    it('should handle service errors gracefully', () => {
      mockService.calculateNextInterval.mockImplementation(() => {
        throw new Error('Service error');
      });
      
      expect(() => algorithm.calculateNextInterval(7, testFeatures)).toThrow('Service error');
    });
  });

  describe('기존 인터페이스 호환성 테스트', () => {
    it('should maintain same method signatures', () => {
      // 메서드 시그니처가 동일한지 확인
      expect(typeof algorithm.calculateNextInterval).toBe('function');
      expect(typeof algorithm.calculateRecallProbability).toBe('function');
      expect(typeof algorithm.needsReview).toBe('function');
      expect(typeof algorithm.createReviewSchedule).toBe('function');
      expect(typeof algorithm.createBatchReviewSchedules).toBe('function');
      expect(typeof algorithm.calculateReviewPriority).toBe('function');
      expect(typeof algorithm.analyzeReviewPerformance).toBe('function');
      expect(typeof algorithm.recommendOptimalInterval).toBe('function');
    });

    it('should return same data types', () => {
      mockService.calculateNextInterval.mockReturnValue(10);
      mockService.calculateRecallProbability.mockReturnValue(0.8);
      mockService.needsReview.mockReturnValue(true);
      
      expect(typeof algorithm.calculateNextInterval(7, testFeatures)).toBe('number');
      expect(typeof algorithm.calculateRecallProbability(5, 7)).toBe('number');
      expect(typeof algorithm.needsReview(5, 7)).toBe('boolean');
    });
  });
});
