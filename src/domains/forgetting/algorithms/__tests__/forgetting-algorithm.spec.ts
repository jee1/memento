/**
 * 망각 알고리즘 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForgettingAlgorithm, type ForgettingFeatures, type ForgettingResult } from './forgetting-algorithm.js';

describe('ForgettingAlgorithm', () => {
  let algorithm: ForgettingAlgorithm;

  beforeEach(() => {
    algorithm = new ForgettingAlgorithm();
  });

  afterEach(() => {
    // Cleanup if needed
  });

  describe('calculateForgetScore', () => {
    it('정상적인 망각 점수 계산', () => {
      const features: ForgettingFeatures = {
        recency: 0.2,        // 오래된 기억
        usage: 0.1,           // 사용되지 않음
        duplication_ratio: 0.8, // 높은 중복
        importance: 0.3,      // 낮은 중요도
        pinned: false         // 고정되지 않음
      };

      const score = algorithm.calculateForgetScore(features);
      
      // 망각 점수는 높아야 함 (0.6 이상)
      expect(score).toBeGreaterThan(0.6);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('최근성 높은 기억의 낮은 망각 점수', () => {
      const features: ForgettingFeatures = {
        recency: 0.9,         // 최근 기억
        usage: 0.8,           // 자주 사용
        duplication_ratio: 0.1, // 낮은 중복
        importance: 0.9,      // 높은 중요도
        pinned: true          // 고정됨
      };

      const score = algorithm.calculateForgetScore(features);
      
      // 망각 점수는 낮아야 함 (0.3 이하)
      expect(score).toBeLessThan(0.3);
    });

    it('경계값 테스트', () => {
      const features: ForgettingFeatures = {
        recency: 0.0,         // 최소값
        usage: 0.0,           // 최소값
        duplication_ratio: 1.0, // 최대값
        importance: 0.0,      // 최소값
        pinned: false         // 고정되지 않음
      };

      const score = algorithm.calculateForgetScore(features);
      
      // 최대 망각 점수
      expect(score).toBeGreaterThanOrEqual(0.8);
    });

    it('최적값 테스트', () => {
      const features: ForgettingFeatures = {
        recency: 1.0,         // 최대값
        usage: 1.0,           // 최대값
        duplication_ratio: 0.0, // 최소값
        importance: 1.0,      // 최대값
        pinned: true          // 고정됨
      };

      const score = algorithm.calculateForgetScore(features);
      
      // 최소 망각 점수
      expect(score).toBeLessThan(0.2);
    });
  });

  describe('shouldForget', () => {
    it('기본 임계값으로 망각 판단', () => {
      expect(algorithm.shouldForget(0.7)).toBe(true);
      expect(algorithm.shouldForget(0.5)).toBe(false);
      expect(algorithm.shouldForget(0.6)).toBe(true);
    });

    it('사용자 정의 임계값으로 망각 판단', () => {
      expect(algorithm.shouldForget(0.8, 0.9)).toBe(false);
      expect(algorithm.shouldForget(0.9, 0.8)).toBe(true);
    });
  });

  describe('generateForgetReason', () => {
    it('오래된 기억 이유 생성', () => {
      const features: ForgettingFeatures = {
        recency: 0.2,
        usage: 0.8,
        duplication_ratio: 0.3,
        importance: 0.7,
        pinned: true
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('오래된 기억');
    });

    it('사용되지 않는 기억 이유 생성', () => {
      const features: ForgettingFeatures = {
        recency: 0.8,
        usage: 0.1,
        duplication_ratio: 0.3,
        importance: 0.7,
        pinned: true
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('사용되지 않음');
    });

    it('중복도 높은 기억 이유 생성', () => {
      const features: ForgettingFeatures = {
        recency: 0.8,
        usage: 0.8,
        duplication_ratio: 0.8,
        importance: 0.7,
        pinned: true
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('중복도 높음');
    });

    it('중요도 낮은 기억 이유 생성', () => {
      const features: ForgettingFeatures = {
        recency: 0.8,
        usage: 0.8,
        duplication_ratio: 0.3,
        importance: 0.2,
        pinned: true
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('중요도 낮음');
    });

    it('고정되지 않은 기억 이유 생성', () => {
      const features: ForgettingFeatures = {
        recency: 0.8,
        usage: 0.8,
        duplication_ratio: 0.3,
        importance: 0.7,
        pinned: false
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('고정되지 않음');
    });

    it('복합 이유 생성', () => {
      const features: ForgettingFeatures = {
        recency: 0.2,
        usage: 0.1,
        duplication_ratio: 0.8,
        importance: 0.2,
        pinned: false
      };

      const reason = algorithm.generateForgetReason(features, 0.9);
      expect(reason).toContain('오래된 기억');
      expect(reason).toContain('사용되지 않음');
      expect(reason).toContain('중복도 높음');
      expect(reason).toContain('중요도 낮음');
      expect(reason).toContain('고정되지 않음');
    });

    it('이유가 없는 경우 점수 기반 이유', () => {
      const features: ForgettingFeatures = {
        recency: 0.8,
        usage: 0.8,
        duplication_ratio: 0.3,
        importance: 0.7,
        pinned: true
      };

      const reason = algorithm.generateForgetReason(features, 0.9);
      expect(reason).toContain('망각 점수 높음');
    });
  });

  describe('calculateFeatures', () => {
    it('정상적인 특징 계산', () => {
      const memory = {
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7일 전
        last_accessed: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2일 전
        importance: 0.7,
        pinned: false,
        type: 'episodic',
        view_count: 5,
        cite_count: 2,
        edit_count: 1
      };

      const features = algorithm.calculateFeatures(memory, 2, 10);
      
      expect(features.recency).toBeGreaterThan(0);
      expect(features.recency).toBeLessThan(1);
      expect(features.usage).toBeGreaterThan(0);
      expect(features.usage).toBeLessThan(1);
      expect(features.duplication_ratio).toBe(0.2); // 2/10
      expect(features.importance).toBe(0.7);
      expect(features.pinned).toBe(false);
    });

    it('last_accessed가 없는 경우', () => {
      const memory = {
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        importance: 0.5,
        pinned: true,
        type: 'semantic'
      };

      const features = algorithm.calculateFeatures(memory, 0, 5);
      
      expect(features.usage).toBeGreaterThanOrEqual(0);
      expect(features.duplication_ratio).toBe(0);
      expect(features.pinned).toBe(true);
    });

    it('다양한 메모리 타입별 반감기 테스트', () => {
      const baseDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10일 전
      
      const workingMemory = {
        created_at: baseDate.toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'working'
      };

      const episodicMemory = {
        created_at: baseDate.toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'episodic'
      };

      const workingFeatures = algorithm.calculateFeatures(workingMemory, 0, 1);
      const episodicFeatures = algorithm.calculateFeatures(episodicMemory, 0, 1);
      
      // working 메모리는 더 빠르게 감쇠
      expect(workingFeatures.recency).toBeLessThan(episodicFeatures.recency);
    });
  });

  describe('analyzeForgetCandidates', () => {
    it('정상적인 망각 후보 분석', () => {
      const memories = [
        {
          id: 'mem1',
          created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30일 전
          importance: 0.2,
          pinned: false,
          type: 'episodic',
          view_count: 1,
          cite_count: 0,
          edit_count: 0
        },
        {
          id: 'mem2',
          created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1일 전
          importance: 0.8,
          pinned: true,
          type: 'semantic',
          view_count: 10,
          cite_count: 5,
          edit_count: 2
        }
      ];

      const results = algorithm.analyzeForgetCandidates(memories);
      
      expect(results).toHaveLength(2);
      expect(results[0].memory_id).toBe('mem1'); // 망각 점수가 높은 것부터
      expect(results[0].forget_score).toBeGreaterThan(results[1].forget_score);
      expect(results[0].should_forget).toBe(false);
      expect(results[1].should_forget).toBe(false);
    });

    it('빈 메모리 배열 처리', () => {
      const results = algorithm.analyzeForgetCandidates([]);
      expect(results).toHaveLength(0);
    });

    it('단일 메모리 처리', () => {
      const memories = [{
        id: 'mem1',
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'episodic'
      }];

      const results = algorithm.analyzeForgetCandidates(memories);
      
      expect(results).toHaveLength(1);
      expect(results[0].memory_id).toBe('mem1');
      expect(results[0].features.duplication_ratio).toBe(0); // 중복 없음
    });

    it('정렬 확인 (망각 점수 내림차순)', () => {
      const memories = [
        {
          id: 'mem1',
          created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60일 전
          importance: 0.1,
          pinned: false,
          type: 'episodic'
        },
        {
          id: 'mem2',
          created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1일 전
          importance: 0.9,
          pinned: true,
          type: 'semantic'
        }
      ];

      const results = algorithm.analyzeForgetCandidates(memories);
      
      expect(results[0].forget_score).toBeGreaterThanOrEqual(results[1].forget_score);
    });
  });

  describe('사용자 정의 가중치', () => {
    it('사용자 정의 가중치로 알고리즘 생성', () => {
      const customWeights = {
        recency: 0.5,
        usage: 0.3,
        duplication: 0.1,
        importance: 0.05,
        pinned: 0.05
      };

      const customAlgorithm = new ForgettingAlgorithm(customWeights);
      
      const features: ForgettingFeatures = {
        recency: 0.2,
        usage: 0.1,
        duplication_ratio: 0.8,
        importance: 0.3,
        pinned: false
      };

      const score = customAlgorithm.calculateForgetScore(features);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('엣지 케이스', () => {
    it('잘못된 날짜 형식 처리', () => {
      const memory = {
        created_at: 'invalid-date',
        importance: 0.5,
        pinned: false,
        type: 'episodic'
      };

      // 잘못된 날짜는 기본값으로 처리됨
      const features = algorithm.calculateFeatures(memory, 0, 1);
      expect(features).toBeDefined();
    });

    it('음수 값 처리', () => {
      const memory = {
        created_at: new Date().toISOString(),
        importance: -0.1,
        pinned: false,
        type: 'episodic',
        view_count: -1,
        cite_count: -1,
        edit_count: -1
      };

      const features = algorithm.calculateFeatures(memory, 0, 1);
      
      // 음수 값들이 그대로 사용됨 (정규화되지 않음)
      expect(features.importance).toBe(-0.1);
      expect(features.usage).toBeGreaterThanOrEqual(0);
    });

    it('매우 큰 값 처리', () => {
      const memory = {
        created_at: new Date().toISOString(),
        importance: 10.0,
        pinned: false,
        type: 'episodic',
        view_count: 1000000,
        cite_count: 1000000,
        edit_count: 1000000
      };

      const features = algorithm.calculateFeatures(memory, 0, 1);
      
      // 값들이 그대로 사용됨 (정규화되지 않음)
      expect(features.importance).toBe(10.0);
      expect(features.usage).toBeLessThanOrEqual(1);
    });
  });
});
