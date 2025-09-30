import { describe, it, expect, beforeEach } from 'vitest';
import { 
  SpacedRepetitionAlgorithm, 
  SpacedRepetitionFeatures, 
  SpacedRepetitionWeights,
  ReviewSchedule 
} from './spaced-repetition.js';

describe('SpacedRepetitionAlgorithm', () => {
  let algorithm: SpacedRepetitionAlgorithm;

  beforeEach(() => {
    algorithm = new SpacedRepetitionAlgorithm();
  });

  describe('calculateNextInterval', () => {
    it('기본 가중치로 간격을 계산한다', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.8,
        usage: 0.6,
        helpful_feedback: 0.4,
        bad_feedback: 0.2
      };

      const currentInterval = 7;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);

      // 7 * (1 + 0.6*0.8 + 0.4*0.6 + 0.5*0.4 - 0.7*0.2)
      // = 7 * (1 + 0.48 + 0.24 + 0.2 - 0.14)
      // = 7 * 1.78 = 12.46 -> Math.ceil = 13
      expect(nextInterval).toBe(13);
    });

    it('모든 피드백이 0일 때 기본 간격을 유지한다', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0,
        usage: 0,
        helpful_feedback: 0,
        bad_feedback: 0
      };

      const currentInterval = 5;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);

      expect(nextInterval).toBe(5);
    });

    it('높은 중요도와 사용성으로 간격을 늘린다', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 1.0,
        usage: 1.0,
        helpful_feedback: 0,
        bad_feedback: 0
      };

      const currentInterval = 10;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);

      // 10 * (1 + 0.6*1.0 + 0.4*1.0 + 0.5*0 - 0.7*0)
      // = 10 * (1 + 0.6 + 0.4) = 10 * 2.0 = 20
      expect(nextInterval).toBe(20);
    });

    it('나쁜 피드백으로 간격을 줄인다', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0,
        bad_feedback: 1.0
      };

      const currentInterval = 10;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);

      // 10 * (1 + 0.6*0.5 + 0.4*0.5 + 0.5*0 - 0.7*1.0)
      // = 10 * (1 + 0.3 + 0.2 - 0.7) = 10 * 0.8 = 8
      expect(nextInterval).toBe(8);
    });

    it('사용자 정의 가중치를 사용한다', () => {
      const customWeights: SpacedRepetitionWeights = {
        importance: 1.0,
        usage: 0.5,
        helpful_feedback: 0.3,
        bad_feedback: 0.8
      };

      const customAlgorithm = new SpacedRepetitionAlgorithm(customWeights);
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0.5,
        bad_feedback: 0.5
      };

      const currentInterval = 10;
      const nextInterval = customAlgorithm.calculateNextInterval(currentInterval, features);

      // 10 * (1 + 1.0*0.5 + 0.5*0.5 + 0.3*0.5 - 0.8*0.5)
      // = 10 * (1 + 0.5 + 0.25 + 0.15 - 0.4) = 10 * 1.5 = 15
      expect(nextInterval).toBe(15);
    });
  });

  describe('calculateRecallProbability', () => {
    it('시간이 지날수록 리콜 확률이 감소한다', () => {
      const interval = 7;
      
      const prob1 = algorithm.calculateRecallProbability(0, interval);
      const prob2 = algorithm.calculateRecallProbability(3, interval);
      const prob3 = algorithm.calculateRecallProbability(7, interval);

      expect(prob1).toBe(1.0); // 즉시 리뷰 시 100%
      expect(prob2).toBeGreaterThan(prob3); // 3일 후 > 7일 후
      expect(prob3).toBeCloseTo(0.368, 2); // exp(-1) ≈ 0.368
    });

    it('간격이 길수록 리콜 확률이 높게 유지된다', () => {
      const timeSinceLastReview = 7;
      
      const probShort = algorithm.calculateRecallProbability(timeSinceLastReview, 7);
      const probLong = algorithm.calculateRecallProbability(timeSinceLastReview, 14);

      expect(probLong).toBeGreaterThan(probShort);
    });

    it('극값에서 올바르게 동작한다', () => {
      const interval = 10;
      
      const probZero = algorithm.calculateRecallProbability(0, interval);
      const probVeryLong = algorithm.calculateRecallProbability(1000, interval);

      expect(probZero).toBe(1.0);
      expect(probVeryLong).toBeCloseTo(0, 5);
    });
  });

  describe('needsReview', () => {
    it('기본 임계값으로 리뷰 필요 여부를 판단한다', () => {
      const timeSinceLastReview = 5;
      const interval = 7;

      const needsReview = algorithm.needsReview(timeSinceLastReview, interval);

      // 리콜 확률 = exp(-5/7) ≈ 0.49 < 0.7 (기본 임계값)
      expect(needsReview).toBe(true);
    });

    it('사용자 정의 임계값을 사용한다', () => {
      const timeSinceLastReview = 3;
      const interval = 7;
      const customThreshold = 0.5;

      const needsReview = algorithm.needsReview(timeSinceLastReview, interval, customThreshold);

      // 리콜 확률 = exp(-3/7) ≈ 0.65 > 0.5 (사용자 임계값)
      expect(needsReview).toBe(false);
    });

    it('리콜 확률이 임계값과 같을 때 true를 반환한다', () => {
      const timeSinceLastReview = 7;
      const interval = 7;
      const threshold = 0.368; // exp(-1)

      const needsReview = algorithm.needsReview(timeSinceLastReview, interval, threshold);

      expect(needsReview).toBe(true);
    });
  });

  describe('createReviewSchedule', () => {
    it('리뷰 스케줄을 생성한다', () => {
      const memoryId = 'test-memory-1';
      const currentInterval = 7;
      const lastReviewDate = new Date('2024-01-01');
      const features: SpacedRepetitionFeatures = {
        importance: 0.8,
        usage: 0.6,
        helpful_feedback: 0.4,
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
      expect(typeof schedule.needs_review).toBe('boolean');
      expect(schedule.multiplier).toBeGreaterThan(1);
    });

    it('다음 리뷰 날짜가 올바르게 계산된다', () => {
      const memoryId = 'test-memory-2';
      const currentInterval = 5;
      const lastReviewDate = new Date('2024-01-01T10:00:00Z');
      const features: SpacedRepetitionFeatures = {
        importance: 0,
        usage: 0,
        helpful_feedback: 0,
        bad_feedback: 0
      };

      const schedule = algorithm.createReviewSchedule(
        memoryId,
        currentInterval,
        lastReviewDate,
        features
      );

      // features가 모두 0이므로 간격이 변하지 않아 5일 후
      const expectedNextReview = new Date(lastReviewDate.getTime() + 5 * 24 * 60 * 60 * 1000);
      
      // 날짜가 정확히 일치하는지 확인
      expect(schedule.next_review.getTime()).toBe(expectedNextReview.getTime());
    });
  });

  describe('createBatchReviewSchedules', () => {
    it('배치 리뷰 스케줄을 생성한다', () => {
      const memories = [
        {
          id: 'memory-1',
          current_interval: 7,
          last_review: new Date('2024-01-01'),
          importance: 0.8,
          usage: 0.6,
          helpful_feedback: 0.4,
          bad_feedback: 0.2
        },
        {
          id: 'memory-2',
          current_interval: 14,
          last_review: new Date('2024-01-02'),
          importance: 0.5,
          usage: 0.3,
          helpful_feedback: 0.1,
          bad_feedback: 0.1
        }
      ];

      const schedules = algorithm.createBatchReviewSchedules(memories);

      expect(schedules).toHaveLength(2);
      expect(schedules[0].memory_id).toBe('memory-1');
      expect(schedules[1].memory_id).toBe('memory-2');
      expect(schedules[0].current_interval).toBeGreaterThan(7);
      expect(schedules[1].current_interval).toBeGreaterThan(14);
    });

    it('빈 배열에 대해 빈 배열을 반환한다', () => {
      const schedules = algorithm.createBatchReviewSchedules([]);
      expect(schedules).toHaveLength(0);
    });
  });

  describe('calculateReviewPriority', () => {
    it('리콜 확률이 낮을수록 우선순위가 높다', () => {
      const schedule1: ReviewSchedule = {
        memory_id: 'memory-1',
        current_interval: 7,
        next_review: new Date(),
        recall_probability: 0.2,
        needs_review: true,
        multiplier: 1.5
      };

      const schedule2: ReviewSchedule = {
        memory_id: 'memory-2',
        current_interval: 7,
        next_review: new Date(),
        recall_probability: 0.8,
        needs_review: true,
        multiplier: 1.5
      };

      const priority1 = algorithm.calculateReviewPriority(schedule1);
      const priority2 = algorithm.calculateReviewPriority(schedule2);

      expect(priority1).toBeGreaterThan(priority2);
    });

    it('간격이 길수록 우선순위가 높다', () => {
      const schedule1: ReviewSchedule = {
        memory_id: 'memory-1',
        current_interval: 7,
        next_review: new Date(),
        recall_probability: 0.5,
        needs_review: true,
        multiplier: 1.5
      };

      const schedule2: ReviewSchedule = {
        memory_id: 'memory-2',
        current_interval: 30,
        next_review: new Date(),
        recall_probability: 0.5,
        needs_review: true,
        multiplier: 1.5
      };

      const priority1 = algorithm.calculateReviewPriority(schedule1);
      const priority2 = algorithm.calculateReviewPriority(schedule2);

      expect(priority2).toBeGreaterThan(priority1);
    });
  });

  describe('analyzeReviewPerformance', () => {
    it('리뷰 성과를 분석한다', () => {
      const schedules: ReviewSchedule[] = [
        {
          memory_id: 'memory-1',
          current_interval: 7,
          next_review: new Date(),
          recall_probability: 0.5,
          needs_review: true,
          multiplier: 1.5
        },
        {
          memory_id: 'memory-2',
          current_interval: 14,
          next_review: new Date(),
          recall_probability: 0.3,
          needs_review: true,
          multiplier: 2.0
        }
      ];

      const actualRecall = new Map([
        ['memory-1', true],
        ['memory-2', false]
      ]);

      const analysis = algorithm.analyzeReviewPerformance(schedules, actualRecall);

      expect(analysis.totalMemories).toBe(2);
      expect(analysis.reviewedMemories).toBe(2);
      expect(analysis.averageRecallRate).toBe(0.5); // 1개 성공 / 2개 전체
      expect(analysis.performanceByInterval).toBeInstanceOf(Map);
    });

    it('빈 스케줄에 대해 기본값을 반환한다', () => {
      const schedules: ReviewSchedule[] = [];
      const actualRecall = new Map();

      const analysis = algorithm.analyzeReviewPerformance(schedules, actualRecall);

      expect(analysis.totalMemories).toBe(0);
      expect(analysis.reviewedMemories).toBe(0);
      expect(analysis.averageRecallRate).toBe(0);
    });

    it('실제 리콜 데이터가 없는 경우를 처리한다', () => {
      const schedules: ReviewSchedule[] = [
        {
          memory_id: 'memory-1',
          current_interval: 7,
          next_review: new Date(),
          recall_probability: 0.5,
          needs_review: true,
          multiplier: 1.5
        }
      ];

      const actualRecall = new Map();

      const analysis = algorithm.analyzeReviewPerformance(schedules, actualRecall);

      expect(analysis.averageRecallRate).toBe(0);
    });
  });

  describe('recommendOptimalInterval', () => {
    it('성과가 좋으면 간격을 늘린다', () => {
      const currentInterval = 7;
      const recallHistory = [true, true, true, true, true]; // 100% 성공률
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0,
        bad_feedback: 0
      };

      const recommendedInterval = algorithm.recommendOptimalInterval(
        currentInterval,
        recallHistory,
        features
      );

      expect(recommendedInterval).toBeGreaterThan(currentInterval);
    });

    it('성과가 나쁘면 간격을 줄인다', () => {
      const currentInterval = 7;
      const recallHistory = [false, false, false, false, false]; // 0% 성공률
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0,
        bad_feedback: 0
      };

      const recommendedInterval = algorithm.recommendOptimalInterval(
        currentInterval,
        recallHistory,
        features
      );

      // 성과가 나쁠 때는 adjustmentFactor(0.8)가 적용되어 간격이 줄어들어야 함
      const baseInterval = algorithm.calculateNextInterval(currentInterval, features);
      const expectedInterval = Math.ceil(baseInterval * 0.8);
      expect(recommendedInterval).toBe(expectedInterval);
      expect(recommendedInterval).toBeLessThan(baseInterval);
    });

    it('빈 히스토리에 대해 현재 간격을 반환한다', () => {
      const currentInterval = 7;
      const recallHistory: boolean[] = [];
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0,
        bad_feedback: 0
      };

      const recommendedInterval = algorithm.recommendOptimalInterval(
        currentInterval,
        recallHistory,
        features
      );

      expect(recommendedInterval).toBe(currentInterval);
    });

    it('중간 성과에 대해 조정 계수를 적용한다', () => {
      const currentInterval = 10;
      const recallHistory = [true, false, true, false, true]; // 60% 성공률
      const features: SpacedRepetitionFeatures = {
        importance: 0.5,
        usage: 0.5,
        helpful_feedback: 0,
        bad_feedback: 0
      };

      const recommendedInterval = algorithm.recommendOptimalInterval(
        currentInterval,
        recallHistory,
        features
      );

      // 60% 성과는 조정 계수가 1.0이므로 기본 계산 결과와 같아야 함
      const baseInterval = algorithm.calculateNextInterval(currentInterval, features);
      expect(recommendedInterval).toBe(baseInterval);
    });
  });

  describe('경계 케이스 및 에러 처리', () => {
    it('극값에서도 안전하게 동작한다', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 1.0,
        usage: 1.0,
        helpful_feedback: 1.0,
        bad_feedback: 1.0
      };

      const currentInterval = 1;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);

      expect(nextInterval).toBeGreaterThan(0);
      expect(Number.isFinite(nextInterval)).toBe(true);
    });

    it('음수 간격을 처리한다', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 0,
        usage: 0,
        helpful_feedback: 0,
        bad_feedback: 1.0
      };

      const currentInterval = 1;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);

      // 음수가 될 수 있지만 Math.ceil로 1이 됨
      expect(nextInterval).toBe(1);
    });

    it('매우 큰 간격을 처리한다', () => {
      const features: SpacedRepetitionFeatures = {
        importance: 1.0,
        usage: 1.0,
        helpful_feedback: 1.0,
        bad_feedback: 0
      };

      const currentInterval = 1000;
      const nextInterval = algorithm.calculateNextInterval(currentInterval, features);

      expect(nextInterval).toBeGreaterThan(currentInterval);
      expect(Number.isFinite(nextInterval)).toBe(true);
    });
  });
});
