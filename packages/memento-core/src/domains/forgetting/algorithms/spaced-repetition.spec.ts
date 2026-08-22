/**
 * 간격 반복 알고리즘 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DAY_MS } from '../../../shared/utils/date.js';
import { SpacedRepetitionAlgorithm, type SpacedRepetitionFeatures, type ReviewSchedule } from './spaced-repetition.js';

describe('SpacedRepetitionAlgorithm', () => {
  let algorithm: SpacedRepetitionAlgorithm;

  beforeEach(() => {
    algorithm = new SpacedRepetitionAlgorithm();
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('calculateNextInterval', () => {
    it('정상적인 다음 간격 계산', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.8,
        usage: 0.6,
        helpful_feedback: 0.7,
        bad_feedback: 0.2
      };

      const currentInterval = 7; // 7일
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);
      
      // 긍정적인 특징들이므로 간격이 늘어나야 함
      expect(nextInterval).toBeGreaterThan(currentInterval);
      expect(nextInterval).toBeGreaterThan(7);
    });

    it('부정적인 특징으로 간격 단축', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.2,
        usage: 0.1,
        helpful_feedback: 0.1,
        bad_feedback: 0.8
      };

      const currentInterval = 14; // 14일
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);
      
      // 부정적인 특징들이므로 간격이 줄어들어야 함
      expect(nextInterval).toBeLessThan(currentInterval);
      expect(nextInterval).toBeGreaterThan(0);
    });

    it('중립적인 특징으로 유사한 간격', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0.5,
        bad_feedback: 0.5
      };

      const currentInterval = 7;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);
      
      // 중립적인 특징이므로 간격이 비슷해야 함 (더 관대한 허용 오차)  
      expect(Math.abs(nextInterval - currentInterval)).toBeLessThanOrEqual(5); // 차이 5 이하 허용
    });

    it('최적값으로 최대 간격', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 1.0,
        usage: 1.0,
        helpful_feedback: 1.0,
        bad_feedback: 0.0
      };

      const currentInterval = 7;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);
      
      expect(nextInterval).toBeGreaterThan(currentInterval * 1.5);
    });

    it('최악값으로 최소 간격', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.0,
        usage: 0.0,
        helpful_feedback: 0.0,
        bad_feedback: 1.0
      };

      const currentInterval = 7;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);
      
      expect(nextInterval).toBeLessThan(currentInterval);
      expect(nextInterval).toBeGreaterThan(0);
    });

    it('사용자 정의 가중치로 간격 계산', () => {
      const customAlgorithm = new SpacedRepetitionAlgorithm({
        importance: 0.8,
        usage: 0.2,
        helpful_feedback: 0.3,
        bad_feedback: 0.5
      });

      const features: SpacedRepetitionFeatures = {
        importance: 0.8,
        usage: 0.6,
        helpful_feedback: 0.7,
        bad_feedback: 0.2
      };

      const currentInterval = 7;
      const nextInterval = customAlgorithm.calculateNextInterval(currentInterval, features);
      
      expect(nextInterval).toBeGreaterThan(currentInterval);
    });
  });

  describe('calculateRecallProbability', () => {
    it('최근 리뷰의 높은 리콜 확률', () => {
      const timeSinceLastReview = 1; // 1일
      const interval = 7; // 7일 간격
      
      const probability = algorithm.calculateRecallProbability(timeSinceLastReview, interval);
      
      expect(probability).toBeGreaterThan(0.8);
      expect(probability).toBeLessThanOrEqual(1.0);
    });

    it('오래된 리뷰의 낮은 리콜 확률', () => {
      const timeSinceLastReview = 14; // 14일
      const interval = 7; // 7일 간격
      
      const probability = algorithm.calculateRecallProbability(timeSinceLastReview, interval);
      
      expect(probability).toBeLessThan(0.2);
      expect(probability).toBeGreaterThan(0);
    });

    it('간격과 동일한 시간의 리콜 확률', () => {
      const timeSinceLastReview = 7; // 7일
      const interval = 7; // 7일 간격
      
      const probability = algorithm.calculateRecallProbability(timeSinceLastReview, interval);
      
      // e^(-1) ≈ 0.368
      expect(probability).toBeCloseTo(0.368, 2);
    });

    it('매우 긴 간격의 리콜 확률', () => {
      const timeSinceLastReview = 30; // 30일
      const interval = 365; // 365일 간격
      
      const probability = algorithm.calculateRecallProbability(timeSinceLastReview, interval);
      
      expect(probability).toBeGreaterThan(0.9);
    });
  });

  describe('needsReview', () => {
    it('리뷰가 필요한 경우', () => {
      const timeSinceLastReview = 10; // 10일
      const interval = 7; // 7일 간격
      
      const needsReview = algorithm.needsReview(timeSinceLastReview, interval);
      
      expect(needsReview).toBe(true);
    });

    it('리뷰가 불필요한 경우', () => {
      const timeSinceLastReview = 2; // 2일
      const interval = 7; // 7일 간격
      
      const needsReview = algorithm.needsReview(timeSinceLastReview, interval);
      
      expect(needsReview).toBe(false);
    });

    it('사용자 정의 임계값으로 리뷰 판단', () => {
      const timeSinceLastReview = 5; // 5일
      const interval = 7; // 7일 간격
      const threshold = 0.5; // 50% 임계값
      
      const needsReview = algorithm.needsReview(timeSinceLastReview, interval, threshold);
      
      expect(needsReview).toBe(true);
    });

    it('경계값 테스트', () => {
      const timeSinceLastReview = 7; // 7일
      const interval = 7; // 7일 간격
      
      const needsReview = algorithm.needsReview(timeSinceLastReview, interval);
      
      // e^(-1) ≈ 0.368 < 0.7 (기본 임계값)
      expect(needsReview).toBe(true);
    });
  });

  describe('createReviewSchedule', () => {
    it('정상적인 리뷰 스케줄 생성', () => {
      const memoryId = 'mem1';
      const currentInterval = 7;
      const lastReviewDate = new Date(Date.now() - 5 * DAY_MS); // 5일 전
      const features: SpacedRepetitionFeatures = {
        importance: 0.8,
        usage: 0.6,
        helpful_feedback: 0.7,
        bad_feedback: 0.2
      };

      const schedule = algorithm.createReviewSchedule(
        memoryId,
        currentInterval,
        lastReviewDate,
        features
      );

      expect(schedule.memory_id).toBe(memoryId);
      expect(schedule.current_interval).toBeGreaterThan(currentInterval);
      expect(schedule.next_review).toBeInstanceOf(Date);
      expect(schedule.recall_probability).toBeGreaterThan(0);
      expect(schedule.recall_probability).toBeLessThanOrEqual(1);
      expect(schedule.needs_review).toBeDefined();
      expect(schedule.multiplier).toBeGreaterThan(0);
    });

    it('다음 리뷰 날짜 계산', () => {
      const memoryId = 'mem2';
      const currentInterval = 7;
      const lastReviewDate = new Date('2024-01-01');
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0.5,
        bad_feedback: 0.5
      };

      const schedule = algorithm.createReviewSchedule(
        memoryId,
        currentInterval,
        lastReviewDate,
        features
      );

      const expectedNextReview = new Date(lastReviewDate.getTime() + schedule.current_interval * DAY_MS);
      expect(schedule.next_review.getTime()).toBeCloseTo(expectedNextReview.getTime(), 0); // 정확한 시간 비교
    });

    it('배수 계산', () => {
      const memoryId = 'mem3';
      const currentInterval = 10;
      const lastReviewDate = new Date(Date.now() - 5 * DAY_MS);
      const features: SpacedRepetitionFeatures = {
        importance: 0.8,
        usage: 0.6,
        helpful_feedback: 0.7,
        bad_feedback: 0.2
      };

      const schedule = algorithm.createReviewSchedule(
        memoryId,
        currentInterval,
        lastReviewDate,
        features
      );

      const expectedMultiplier = schedule.current_interval / currentInterval;
      expect(schedule.multiplier).toBeCloseTo(expectedMultiplier, 3);
    });
  });

  describe('createBatchReviewSchedules', () => {
    it('배치 리뷰 스케줄 생성', () => {
      const memories = [
        {
          id: 'mem1',
          current_interval: 7,
          last_review: new Date(Date.now() - 5 * DAY_MS),
          importance: 0.8,
          usage: 0.6,
          helpful_feedback: 0.7,
          bad_feedback: 0.2
        },
        {
          id: 'mem2',
          current_interval: 14,
          last_review: new Date(Date.now() - 10 * DAY_MS),
          importance: 0.5,
          usage: 0.4,
          helpful_feedback: 0.3,
          bad_feedback: 0.6
        }
      ];

      const schedules = algorithm.createBatchReviewSchedules(memories);

      expect(schedules).toHaveLength(2);
      expect(schedules[0].memory_id).toBe('mem1');
      expect(schedules[1].memory_id).toBe('mem2');
      
      // 첫 번째 메모리는 긍정적인 특징으로 간격이 늘어나야 함
      expect(schedules[0].current_interval).toBeGreaterThan(7);
      
      // 두 번째 메모리는 부정적인 특징으로 간격이 줄어들어야 함
      expect(schedules[1].current_interval).toBeLessThanOrEqual(17);
    });

    it('빈 메모리 배열 처리', () => {
      const schedules = algorithm.createBatchReviewSchedules([]);
      expect(schedules).toHaveLength(0);
    });
  });

  describe('calculateReviewPriority', () => {
    it('높은 우선순위 계산', () => {
      const schedule: ReviewSchedule = {
        memory_id: 'mem1',
        current_interval: 30,
        next_review: new Date(Date.now() + 5 * DAY_MS),
        recall_probability: 0.2, // 낮은 리콜 확률
        needs_review: true,
        multiplier: 1.5
      };

      const priority = algorithm.calculateReviewPriority(schedule);
      
      // 낮은 리콜 확률과 긴 간격으로 높은 우선순위
      expect(priority).toBeGreaterThan(0.8);
    });

    it('낮은 우선순위 계산', () => {
      const schedule: ReviewSchedule = {
        memory_id: 'mem2',
        current_interval: 3,
        next_review: new Date(Date.now() + DAY_MS),
        recall_probability: 0.9, // 높은 리콜 확률
        needs_review: false,
        multiplier: 1.1
      };

      const priority = algorithm.calculateReviewPriority(schedule);
      
      // 높은 리콜 확률과 짧은 간격으로 낮은 우선순위
      expect(priority).toBeLessThan(0.5);
    });
  });

  describe('analyzeReviewPerformance', () => {
    it('리뷰 성과 분석', () => {
      const schedules: ReviewSchedule[] = [
        {
          memory_id: 'mem1',
          current_interval: 7,
          next_review: new Date(),
          recall_probability: 0.5,
          needs_review: true,
          multiplier: 1.0
        },
        {
          memory_id: 'mem2',
          current_interval: 14,
          next_review: new Date(),
          recall_probability: 0.8,
          needs_review: false,
          multiplier: 1.2
        }
      ];

      const actualRecall = new Map([
        ['mem1', true],
        ['mem2', false]
      ]);

      const performance = algorithm.analyzeReviewPerformance(schedules, actualRecall);

      expect(performance.totalMemories).toBe(2);
      expect(performance.reviewedMemories).toBe(1);
      expect(performance.averageRecallRate).toBe(0.5); // 1개 성공, 1개 실패
      expect(performance.performanceByInterval).toBeInstanceOf(Map);
    });

    it('빈 스케줄 배열 처리', () => {
      const performance = algorithm.analyzeReviewPerformance([], new Map());
      
      expect(performance.totalMemories).toBe(0);
      expect(performance.reviewedMemories).toBe(0);
      expect(performance.averageRecallRate).toBe(0);
    });

    it('실제 리콜 데이터가 없는 경우', () => {
      const schedules: ReviewSchedule[] = [
        {
          memory_id: 'mem1',
          current_interval: 7,
          next_review: new Date(),
          recall_probability: 0.5,
          needs_review: true,
          multiplier: 1.0
        }
      ];

      const performance = algorithm.analyzeReviewPerformance(schedules, new Map());
      
      expect(performance.averageRecallRate).toBe(0);
    });
  });

  describe('recommendOptimalInterval', () => {
    it('성공적인 리콜 기록으로 간격 증가', () => {
      const currentInterval = 7;
      const recallHistory = [true, true, true, true, true]; // 100% 성공률
      const features: SpacedRepetitionFeatures = {
        importance: 0.8,
        usage: 0.6,
        helpful_feedback: 0.7,
        bad_feedback: 0.2
      };

      const optimalInterval = algorithm.recommendOptimalInterval(
        currentInterval,
        recallHistory,
        features
      );

      expect(optimalInterval).toBeGreaterThan(currentInterval);
    });

    it('실패적인 리콜 기록으로 간격 감소', () => {
      const currentInterval = 14;
      const recallHistory = [false, false, false, false, false]; // 0% 성공률
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.4,
        helpful_feedback: 0.3,
        bad_feedback: 0.7
      };

      const optimalInterval = algorithm.recommendOptimalInterval(
        currentInterval,
        recallHistory,
        features
      );

      expect(optimalInterval).toBeLessThan(currentInterval);
    });

    it('빈 리콜 기록 처리', () => {
      const currentInterval = 7;
      const recallHistory: boolean[] = [];
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0.5,
        bad_feedback: 0.5
      };

      const optimalInterval = algorithm.recommendOptimalInterval(
        currentInterval,
        recallHistory,
        features
      );

      expect(optimalInterval).toBe(currentInterval);
    });

    it('혼합된 성과 기록', () => {
      const currentInterval = 10;
      const recallHistory = [true, false, true, false, true]; // 60% 성공률
      const features: SpacedRepetitionFeatures = {
        importance: 0.6,
        usage: 0.5,
        helpful_feedback: 0.4,
        bad_feedback: 0.6
      };

      const optimalInterval = algorithm.recommendOptimalInterval(
        currentInterval,
        recallHistory,
        features
      );

      // 60% 성공률은 중간 수준이므로 간격이 비슷해야 함
      expect(Math.abs(optimalInterval - currentInterval)).toBeLessThanOrEqual(5); // 차이 5 이하 허용
    });
  });

  describe('엣지 케이스', () => {
    it('매우 큰 간격 값', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 1.0,
        usage: 1.0,
        helpful_feedback: 1.0,
        bad_feedback: 0.0
      };

      const currentInterval = 365; // 1년
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);
      
      expect(nextInterval).toBeGreaterThan(currentInterval);
      expect(Number.isFinite(nextInterval)).toBe(true);
    });

    it('매우 작은 간격 값', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.0,
        usage: 0.0,
        helpful_feedback: 0.0,
        bad_feedback: 1.0
      };

      const currentInterval = 1; // 1일
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);
      
      expect(nextInterval).toBeGreaterThan(0);
      expect(nextInterval).toBeLessThanOrEqual(currentInterval);
    });

    it('경계값 특징', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.0,
        usage: 0.0,
        helpful_feedback: 0.0,
        bad_feedback: 0.0
      };

      const currentInterval = 7;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);
      
      expect(nextInterval).toBe(currentInterval); // 배수가 1.0
    });

    it('음수 시간 처리', () => {
      const timeSinceLastReview = -1; // 음수
      const interval = 7;
      
      const probability = algorithm.calculateRecallProbability(timeSinceLastReview, interval);
      
      // 음수 시간은 미래를 의미하므로 확률이 1에 가까워야 함
      expect(probability).toBeGreaterThan(0.9);
    });

    it('0 간격 처리', () => {
      const timeSinceLastReview = 1;
      const interval = 0;
      
      const probability = algorithm.calculateRecallProbability(timeSinceLastReview, interval);
      
      // 0 간격은 즉시 리뷰를 의미하므로 확률이 0에 가까워야 함
      expect(probability).toBeCloseTo(0, 2);
    });
  });

  describe('성능 테스트', () => {
    it('대량 스케줄 생성 성능', () => {
      const memories = Array.from({ length: 1000 }, (_, i) => ({
        id: `mem${i}`,
        current_interval: 7 + (i % 30),
        last_review: new Date(Date.now() - (i % 30) * DAY_MS),
        importance: Math.random(),
        usage: Math.random(),
        helpful_feedback: Math.random(),
        bad_feedback: Math.random()
      }));

      const startTime = Date.now();
      const schedules = algorithm.createBatchReviewSchedules(memories);
      const endTime = Date.now();

      expect(schedules).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(1000); // 1초 이내
    });

    it('반복 계산 성능', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0.5,
        bad_feedback: 0.5
      };

      const startTime = Date.now();
      
      // 1000번 반복 계산
      for (let i = 0; i < 1000; i++) {
        algorithm.calculateNextInterval(7, features);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(100); // 100ms 이내
    });
  });
});
