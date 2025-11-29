/**
 * 리뷰 스케줄링 서비스 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  DefaultReviewScheduler, 
  PriorityBasedReviewScheduler, 
  AdaptiveReviewScheduler 
} from './review-scheduling.service.js';
import { DefaultIntervalStrategy } from './interval-calculation.service.js';
import { DefaultRecallProbabilityCalculator } from './recall-probability.service.js';
import type { 
  SpacedRepetitionFeatures, 
  MemoryData,
  SpacedRepetitionWeights 
} from '../../shared/types/spaced-repetition.types.js';

describe('ReviewSchedulingService', () => {
  let intervalStrategy: DefaultIntervalStrategy;
  let recallCalculator: DefaultRecallProbabilityCalculator;
  let necessityChecker: any;
  let testFeatures: SpacedRepetitionFeatures;
  let testMemory: MemoryData;

  beforeEach(() => {
    const weights: SpacedRepetitionWeights = {
      importance: 0.6,
      usage: 0.4,
      helpful_feedback: 0.5,
      bad_feedback: 0.7
    };

    intervalStrategy = new DefaultIntervalStrategy(weights);
    recallCalculator = new DefaultRecallProbabilityCalculator();
    
    necessityChecker = {
      needsReview: vi.fn((timeSinceLastReview: number, interval: number, threshold?: number) => {
        const recallProb = Math.exp(-timeSinceLastReview / interval);
        return recallProb <= (threshold || 0.7);
      })
    };

    testFeatures = {
      importance: 0.8,
      usage: 0.6,
      helpful_feedback: 0.7,
      bad_feedback: 0.2
    };

    testMemory = {
      id: 'test-memory-1',
      current_interval: 7,
      last_review: new Date('2024-01-01'),
      importance: 0.8,
      usage: 0.6,
      helpful_feedback: 0.7,
      bad_feedback: 0.2
    };
  });

  describe('DefaultReviewScheduler', () => {
    it('should create review schedule correctly', () => {
      const scheduler = new DefaultReviewScheduler(
        intervalStrategy,
        recallCalculator,
        necessityChecker,
        0.7
      );

      const schedule = scheduler.createReviewSchedule(
        'test-memory-1',
        7,
        new Date('2024-01-01'),
        testFeatures
      );

      expect(schedule.memory_id).toBe('test-memory-1');
      expect(schedule.current_interval).toBeGreaterThan(0);
      expect(schedule.next_review).toBeInstanceOf(Date);
      expect(schedule.recall_probability).toBeGreaterThanOrEqual(0);
      expect(schedule.recall_probability).toBeLessThanOrEqual(1);
      expect(typeof schedule.needs_review).toBe('boolean');
      expect(schedule.multiplier).toBeGreaterThan(0);
    });

    it('should create batch review schedules', () => {
      const scheduler = new DefaultReviewScheduler(
        intervalStrategy,
        recallCalculator,
        necessityChecker,
        0.7
      );

      const memories: MemoryData[] = [testMemory];
      const schedules = scheduler.createBatchReviewSchedules(memories);

      expect(schedules).toHaveLength(1);
      expect(schedules[0].memory_id).toBe('test-memory-1');
    });
  });

  describe('PriorityBasedReviewScheduler', () => {
    it('should prioritize schedules correctly', () => {
      const scheduler = new PriorityBasedReviewScheduler(
        intervalStrategy,
        recallCalculator,
        necessityChecker,
        0.7,
        5 // maxDailyReviews
      );

      const memories: MemoryData[] = [
        { ...testMemory, id: 'memory-1', importance: 0.9 },
        { ...testMemory, id: 'memory-2', importance: 0.3 },
        { ...testMemory, id: 'memory-3', importance: 0.7 },
        { ...testMemory, id: 'memory-4', importance: 0.5 },
        { ...testMemory, id: 'memory-5', importance: 0.8 },
        { ...testMemory, id: 'memory-6', importance: 0.4 }
      ];

      const schedules = scheduler.createBatchReviewSchedules(memories);

      expect(schedules).toHaveLength(5); // maxDailyReviews 제한
      expect(schedules[0].memory_id).toBe('memory-1'); // 가장 높은 중요도
    });
  });

  describe('AdaptiveReviewScheduler', () => {
    it('should adapt based on performance', () => {
      const scheduler = new AdaptiveReviewScheduler(
        intervalStrategy,
        recallCalculator,
        necessityChecker,
        0.7
      );

      // 성과 업데이트
      scheduler.updatePerformance('test-memory-1', true);
      scheduler.updatePerformance('test-memory-1', true);
      scheduler.updatePerformance('test-memory-1', true);

      const schedule = scheduler.createReviewSchedule(
        'test-memory-1',
        7,
        new Date('2024-01-01'),
        testFeatures
      );

      expect(schedule.memory_id).toBe('test-memory-1');
      expect(schedule.current_interval).toBeGreaterThan(0);
    });

    it('should adjust threshold for poor performance', () => {
      const scheduler = new AdaptiveReviewScheduler(
        intervalStrategy,
        recallCalculator,
        necessityChecker,
        0.7
      );

      // 나쁜 성과 업데이트
      scheduler.updatePerformance('test-memory-1', false);
      scheduler.updatePerformance('test-memory-1', false);
      scheduler.updatePerformance('test-memory-1', false);

      const schedule = scheduler.createReviewSchedule(
        'test-memory-1',
        7,
        new Date('2024-01-01'),
        testFeatures
      );

      expect(schedule.memory_id).toBe('test-memory-1');
      expect(schedule.current_interval).toBeGreaterThan(0);
    });
  });
});
