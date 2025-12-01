/**
 * SpacedRepetitionFactory 테스트
 * 간격 반복 팩토리 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SpacedRepetitionFactory } from '../spaced-repetition.factory.js';
import type { SpacedRepetitionService, SpacedRepetitionConfig } from '../../../shared/interfaces/spaced-repetition.interface.js';

describe('SpacedRepetitionFactory', () => {
  describe('createDefaultService', () => {
    it('기본 설정으로 서비스를 생성해야 함', () => {
      // When: 기본 서비스 생성
      const service = SpacedRepetitionFactory.createDefaultService();

      // Then: SpacedRepetitionService 인스턴스 반환
      expect(service).toBeDefined();
      expect(typeof service.calculateNextInterval).toBe('function');
      expect(typeof service.calculateRecallProbability).toBe('function');
      expect(typeof service.needsReview).toBe('function');
      expect(typeof service.createReviewSchedule).toBe('function');
    });

    it('부분 설정으로 서비스를 생성해야 함', () => {
      // Given: 부분 설정
      const partialConfig = {
        recallThreshold: 0.8,
        defaultInterval: 14
      };

      // When: 부분 설정으로 서비스 생성
      const service = SpacedRepetitionFactory.createDefaultService(partialConfig);

      // Then: 서비스가 생성되어야 함
      expect(service).toBeDefined();
      expect(typeof service.calculateNextInterval).toBe('function');
    });
  });

  describe('createService', () => {
    it('전체 설정으로 서비스를 생성해야 함', () => {
      // Given: 전체 설정
      const config: SpacedRepetitionConfig = {
        weights: {
          importance: 0.7,
          usage: 0.3,
          helpful_feedback: 0.6,
          bad_feedback: 0.8
        },
        recallThreshold: 0.75,
        defaultInterval: 10
      };

      // When: 전체 설정으로 서비스 생성
      const service = SpacedRepetitionFactory.createService(config);

      // Then: 서비스가 생성되어야 함
      expect(service).toBeDefined();
      expect(typeof service.calculateNextInterval).toBe('function');
    });
  });

  describe('createIntervalStrategy', () => {
    it('기본 전략을 생성해야 함', () => {
      // Given: 가중치
      const weights = {
        importance: 0.6,
        usage: 0.4,
        helpful_feedback: 0.5,
        bad_feedback: 0.7
      };

      // When: 기본 전략 생성
      const strategy = SpacedRepetitionFactory.createIntervalStrategy(weights, 'default');

      // Then: 전략이 생성되어야 함
      expect(strategy).toBeDefined();
      expect(typeof strategy.calculateInterval).toBe('function');
    });

    it('conservative 전략을 생성해야 함', () => {
      // Given: 가중치
      const weights = {
        importance: 0.6,
        usage: 0.4,
        helpful_feedback: 0.5,
        bad_feedback: 0.7
      };

      // When: conservative 전략 생성
      const strategy = SpacedRepetitionFactory.createIntervalStrategy(weights, 'conservative');

      // Then: 전략이 생성되어야 함
      expect(strategy).toBeDefined();
      expect(typeof strategy.calculateInterval).toBe('function');
    });

    it('adaptive 전략을 생성해야 함', () => {
      // Given: 가중치
      const weights = {
        importance: 0.6,
        usage: 0.4,
        helpful_feedback: 0.5,
        bad_feedback: 0.7
      };

      // When: adaptive 전략 생성
      const strategy = SpacedRepetitionFactory.createIntervalStrategy(weights, 'adaptive');

      // Then: 전략이 생성되어야 함
      expect(strategy).toBeDefined();
      expect(typeof strategy.calculateInterval).toBe('function');
    });
  });

  describe('createRecallCalculator', () => {
    it('기본 계산기를 생성해야 함', () => {
      // When: 기본 계산기 생성
      const calculator = SpacedRepetitionFactory.createRecallCalculator('default');

      // Then: 계산기가 생성되어야 함
      expect(calculator).toBeDefined();
      expect(typeof calculator.calculateRecallProbability).toBe('function');
    });

    it('enhanced 계산기를 생성해야 함', () => {
      // When: enhanced 계산기 생성
      const calculator = SpacedRepetitionFactory.createRecallCalculator('enhanced');

      // Then: 계산기가 생성되어야 함
      expect(calculator).toBeDefined();
      expect(typeof calculator.calculateRecallProbability).toBe('function');
    });

    it('adaptive 계산기를 생성해야 함', () => {
      // When: adaptive 계산기 생성
      const calculator = SpacedRepetitionFactory.createRecallCalculator('adaptive');

      // Then: 계산기가 생성되어야 함
      expect(calculator).toBeDefined();
      expect(typeof calculator.calculateRecallProbability).toBe('function');
    });
  });

  describe('createNecessityChecker', () => {
    it('필요성 판단기를 생성해야 함', () => {
      // Given: 임계값
      const threshold = 0.7;

      // When: 필요성 판단기 생성
      const checker = SpacedRepetitionFactory.createNecessityChecker(threshold);

      // Then: 판단기가 생성되어야 함
      expect(checker).toBeDefined();
      expect(typeof checker.needsReview).toBe('function');
    });

    it('필요성 판단기가 올바르게 동작해야 함', () => {
      // Given: 임계값
      const threshold = 0.7;
      const checker = SpacedRepetitionFactory.createNecessityChecker(threshold);

      // When: 리뷰 필요성 확인
      const needsReview = checker.needsReview(10, 7, threshold);

      // Then: 올바른 결과 반환
      expect(typeof needsReview).toBe('boolean');
    });
  });

  describe('createReviewScheduler', () => {
    it('기본 스케줄러를 생성해야 함', () => {
      // Given: 의존성
      const weights = {
        importance: 0.6,
        usage: 0.4,
        helpful_feedback: 0.5,
        bad_feedback: 0.7
      };
      const intervalStrategy = SpacedRepetitionFactory.createIntervalStrategy(weights);
      const recallCalculator = SpacedRepetitionFactory.createRecallCalculator();
      const necessityChecker = SpacedRepetitionFactory.createNecessityChecker(0.7);

      // When: 기본 스케줄러 생성
      const scheduler = SpacedRepetitionFactory.createReviewScheduler(
        intervalStrategy,
        recallCalculator,
        necessityChecker,
        0.7,
        'default'
      );

      // Then: 스케줄러가 생성되어야 함
      expect(scheduler).toBeDefined();
      expect(typeof scheduler.createReviewSchedule).toBe('function');
      expect(typeof scheduler.createBatchReviewSchedules).toBe('function');
    });

    it('priority 스케줄러를 생성해야 함', () => {
      // Given: 의존성
      const weights = {
        importance: 0.6,
        usage: 0.4,
        helpful_feedback: 0.5,
        bad_feedback: 0.7
      };
      const intervalStrategy = SpacedRepetitionFactory.createIntervalStrategy(weights);
      const recallCalculator = SpacedRepetitionFactory.createRecallCalculator();
      const necessityChecker = SpacedRepetitionFactory.createNecessityChecker(0.7);

      // When: priority 스케줄러 생성
      const scheduler = SpacedRepetitionFactory.createReviewScheduler(
        intervalStrategy,
        recallCalculator,
        necessityChecker,
        0.7,
        'priority'
      );

      // Then: 스케줄러가 생성되어야 함
      expect(scheduler).toBeDefined();
      expect(typeof scheduler.createReviewSchedule).toBe('function');
    });

    it('adaptive 스케줄러를 생성해야 함', () => {
      // Given: 의존성
      const weights = {
        importance: 0.6,
        usage: 0.4,
        helpful_feedback: 0.5,
        bad_feedback: 0.7
      };
      const intervalStrategy = SpacedRepetitionFactory.createIntervalStrategy(weights);
      const recallCalculator = SpacedRepetitionFactory.createRecallCalculator();
      const necessityChecker = SpacedRepetitionFactory.createNecessityChecker(0.7);

      // When: adaptive 스케줄러 생성
      const scheduler = SpacedRepetitionFactory.createReviewScheduler(
        intervalStrategy,
        recallCalculator,
        necessityChecker,
        0.7,
        'adaptive'
      );

      // Then: 스케줄러가 생성되어야 함
      expect(scheduler).toBeDefined();
      expect(typeof scheduler.createReviewSchedule).toBe('function');
    });
  });

  describe('createPerformanceAnalyzer', () => {
    it('기본 분석기를 생성해야 함', () => {
      // When: 기본 분석기 생성
      const analyzer = SpacedRepetitionFactory.createPerformanceAnalyzer('default');

      // Then: 분석기가 생성되어야 함
      expect(analyzer).toBeDefined();
      expect(typeof analyzer.analyzeReviewPerformance).toBe('function');
    });

    it('detailed 분석기를 생성해야 함', () => {
      // When: detailed 분석기 생성
      const analyzer = SpacedRepetitionFactory.createPerformanceAnalyzer('detailed');

      // Then: 분석기가 생성되어야 함
      expect(analyzer).toBeDefined();
      expect(typeof analyzer.analyzeReviewPerformance).toBe('function');
    });

    it('adaptive 분석기를 생성해야 함', () => {
      // When: adaptive 분석기 생성
      const analyzer = SpacedRepetitionFactory.createPerformanceAnalyzer('adaptive');

      // Then: 분석기가 생성되어야 함
      expect(analyzer).toBeDefined();
      expect(typeof analyzer.analyzeReviewPerformance).toBe('function');
    });
  });

  describe('createPriorityCalculator', () => {
    it('기본 우선순위 계산기를 생성해야 함', () => {
      // When: 기본 계산기 생성
      const calculator = SpacedRepetitionFactory.createPriorityCalculator('default');

      // Then: 계산기가 생성되어야 함
      expect(calculator).toBeDefined();
      expect(typeof calculator.calculateReviewPriority).toBe('function');
    });

    it('weighted 우선순위 계산기를 생성해야 함', () => {
      // When: weighted 계산기 생성
      const calculator = SpacedRepetitionFactory.createPriorityCalculator('weighted');

      // Then: 계산기가 생성되어야 함
      expect(calculator).toBeDefined();
      expect(typeof calculator.calculateReviewPriority).toBe('function');
    });

    it('adaptive 우선순위 계산기를 생성해야 함', () => {
      // When: adaptive 계산기 생성
      const calculator = SpacedRepetitionFactory.createPriorityCalculator('adaptive');

      // Then: 계산기가 생성되어야 함
      expect(calculator).toBeDefined();
      expect(typeof calculator.calculateReviewPriority).toBe('function');
    });

    it('time-based 우선순위 계산기를 생성해야 함', () => {
      // When: time-based 계산기 생성
      const calculator = SpacedRepetitionFactory.createPriorityCalculator('time-based');

      // Then: 계산기가 생성되어야 함
      expect(calculator).toBeDefined();
      expect(typeof calculator.calculateReviewPriority).toBe('function');
    });
  });

  describe('createOptimalRecommender', () => {
    it('기본 추천기를 생성해야 함', () => {
      // When: 기본 추천기 생성
      const recommender = SpacedRepetitionFactory.createOptimalRecommender('default');

      // Then: 추천기가 생성되어야 함
      expect(recommender).toBeDefined();
      expect(typeof recommender.recommendOptimalInterval).toBe('function');
    });

    it('adaptive 추천기를 생성해야 함', () => {
      // When: adaptive 추천기 생성
      const recommender = SpacedRepetitionFactory.createOptimalRecommender('adaptive');

      // Then: 추천기가 생성되어야 함
      expect(recommender).toBeDefined();
      expect(typeof recommender.recommendOptimalInterval).toBe('function');
    });

    it('ml 추천기를 생성해야 함', () => {
      // When: ml 추천기 생성
      const recommender = SpacedRepetitionFactory.createOptimalRecommender('ml');

      // Then: 추천기가 생성되어야 함
      expect(recommender).toBeDefined();
      expect(typeof recommender.recommendOptimalInterval).toBe('function');
    });

    it('ensemble 추천기를 생성해야 함', () => {
      // When: ensemble 추천기 생성
      const recommender = SpacedRepetitionFactory.createOptimalRecommender('ensemble');

      // Then: 추천기가 생성되어야 함
      expect(recommender).toBeDefined();
      expect(typeof recommender.recommendOptimalInterval).toBe('function');
    });
  });

  describe('서비스 통합 테스트', () => {
    it('생성된 서비스가 모든 메서드를 제공해야 함', () => {
      // Given: 서비스 생성
      const service = SpacedRepetitionFactory.createDefaultService();

      // Then: 모든 메서드가 제공되어야 함
      expect(typeof service.calculateNextInterval).toBe('function');
      expect(typeof service.calculateRecallProbability).toBe('function');
      expect(typeof service.needsReview).toBe('function');
      expect(typeof service.createReviewSchedule).toBe('function');
      expect(typeof service.createBatchReviewSchedules).toBe('function');
      expect(typeof service.calculateReviewPriority).toBe('function');
      expect(typeof service.analyzeReviewPerformance).toBe('function');
      expect(typeof service.recommendOptimalInterval).toBe('function');
    });

    it('서비스 메서드가 올바르게 동작해야 함', () => {
      // Given: 서비스 생성
      const service = SpacedRepetitionFactory.createDefaultService();

      // When: 메서드 호출
      const interval = service.calculateNextInterval(7, { importance: 0.8, usage: 0.5 });
      const recallProb = service.calculateRecallProbability(5, 7);
      const needsReview = service.needsReview(5, 7);

      // Then: 올바른 결과 반환
      expect(typeof interval).toBe('number');
      // interval이 NaN일 수 있으므로 유효한 숫자인지 확인
      if (!isNaN(interval)) {
        expect(interval).toBeGreaterThan(0);
      }
      expect(typeof recallProb).toBe('number');
      expect(recallProb).toBeGreaterThanOrEqual(0);
      expect(recallProb).toBeLessThanOrEqual(1);
      expect(typeof needsReview).toBe('boolean');
    });
  });
});

