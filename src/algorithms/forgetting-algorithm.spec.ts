/**
 * 망각 알고리즘 테스트
 * ForgettingAlgorithm 클래스의 모든 기능을 테스트합니다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ForgettingAlgorithm, ForgettingFeatures } from './forgetting-algorithm';

describe('ForgettingAlgorithm', () => {
  let algorithm: ForgettingAlgorithm;

  beforeEach(() => {
    algorithm = new ForgettingAlgorithm();
  });

  describe('constructor', () => {
    it('기본 가중치로 초기화되어야 함', () => {
      expect(algorithm).toBeDefined();
    });

    it('사용자 정의 가중치로 초기화되어야 함', () => {
      const customWeights = {
        recency: 0.4,
        usage: 0.3,
        duplication: 0.1,
        importance: 0.1,
        pinned: 0.1
      };
      const customAlgorithm = new ForgettingAlgorithm(customWeights);
      expect(customAlgorithm).toBeDefined();
    });
  });

  describe('calculateForgetScore', () => {
    it('기본 특징에 대한 망각 점수를 계산해야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.5,
        usage: 0.3,
        duplication_ratio: 0.2,
        importance: 0.7,
        pinned: false
      };

      const score = algorithm.calculateForgetScore(features);
      expect(score).toBeCloseTo(0.35 * 0.5 + 0.25 * 0.7 + 0.20 * 0.2 - 0.15 * 0.7 - 0.30 * 0, 3);
    });

    it('고정된 메모리는 낮은 망각 점수를 가져야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.1,
        usage: 0.1,
        duplication_ratio: 0.8,
        importance: 0.2,
        pinned: true
      };

      const score = algorithm.calculateForgetScore(features);
      expect(score).toBeLessThan(0.5); // 고정된 메모리는 낮은 점수
    });

    it('중요한 메모리는 낮은 망각 점수를 가져야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.5,
        usage: 0.5,
        duplication_ratio: 0.2,
        importance: 0.9,
        pinned: false
      };

      const score = algorithm.calculateForgetScore(features);
      expect(score).toBeLessThan(0.3); // 중요한 메모리는 낮은 점수
    });

    it('오래되고 사용되지 않는 메모리는 높은 망각 점수를 가져야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.1,
        usage: 0.1,
        duplication_ratio: 0.8,
        importance: 0.2,
        pinned: false
      };

      const score = algorithm.calculateForgetScore(features);
      expect(score).toBeGreaterThan(0.5); // 망각 후보
    });

    it('최근성과 사용성이 높은 메모리는 낮은 망각 점수를 가져야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.9,
        usage: 0.9,
        duplication_ratio: 0.1,
        importance: 0.5,
        pinned: false
      };

      const score = algorithm.calculateForgetScore(features);
      expect(score).toBeLessThan(0.3); // 낮은 망각 점수
    });
  });

  describe('shouldForget', () => {
    it('기본 임계값 0.6으로 판정해야 함', () => {
      expect(algorithm.shouldForget(0.5)).toBe(false);
      expect(algorithm.shouldForget(0.6)).toBe(true);
      expect(algorithm.shouldForget(0.7)).toBe(true);
    });

    it('사용자 정의 임계값으로 판정해야 함', () => {
      expect(algorithm.shouldForget(0.5, 0.4)).toBe(true);
      expect(algorithm.shouldForget(0.5, 0.6)).toBe(false);
    });
  });

  describe('generateForgetReason', () => {
    it('오래된 기억에 대한 이유를 생성해야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.2,
        usage: 0.5,
        duplication_ratio: 0.3,
        importance: 0.5,
        pinned: false
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('오래된 기억');
    });

    it('사용되지 않는 기억에 대한 이유를 생성해야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.5,
        usage: 0.1,
        duplication_ratio: 0.3,
        importance: 0.5,
        pinned: false
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('사용되지 않음');
    });

    it('중복도가 높은 기억에 대한 이유를 생성해야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.5,
        usage: 0.5,
        duplication_ratio: 0.8,
        importance: 0.5,
        pinned: false
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('중복도 높음');
    });

    it('중요도가 낮은 기억에 대한 이유를 생성해야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.5,
        usage: 0.5,
        duplication_ratio: 0.3,
        importance: 0.2,
        pinned: false
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('중요도 낮음');
    });

    it('고정되지 않은 기억에 대한 이유를 생성해야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.5,
        usage: 0.5,
        duplication_ratio: 0.3,
        importance: 0.5,
        pinned: false
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('고정되지 않음');
    });

    it('여러 이유를 조합해야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.2,
        usage: 0.1,
        duplication_ratio: 0.8,
        importance: 0.2,
        pinned: false
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('오래된 기억');
      expect(reason).toContain('사용되지 않음');
      expect(reason).toContain('중복도 높음');
      expect(reason).toContain('중요도 낮음');
      expect(reason).toContain('고정되지 않음');
    });

    it('이유가 없을 때 점수 기반 이유를 생성해야 함', () => {
      const features: ForgettingFeatures = {
        recency: 0.5,
        usage: 0.5,
        duplication_ratio: 0.3,
        importance: 0.5,
        pinned: true
      };

      const reason = algorithm.generateForgetReason(features, 0.7);
      expect(reason).toContain('망각 점수 높음');
      expect(reason).toContain('0.700');
    });
  });

  describe('calculateFeatures', () => {
    it('기본 메모리 객체에서 특징을 계산해야 함', () => {
      const memory = {
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7일 전
        last_accessed: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1일 전
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
      expect(features.duplication_ratio).toBe(0.2);
      expect(features.importance).toBe(0.7);
      expect(features.pinned).toBe(false);
    });

    it('last_accessed가 없는 경우를 처리해야 함', () => {
      const memory = {
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'semantic',
        view_count: 0,
        cite_count: 0,
        edit_count: 0
      };

      const features = algorithm.calculateFeatures(memory, 0, 5);
      
      expect(features.recency).toBeGreaterThan(0);
      expect(features.usage).toBeGreaterThanOrEqual(0);
      expect(features.duplication_ratio).toBe(0);
    });

    it('중복 비율을 올바르게 계산해야 함', () => {
      const memory = {
        created_at: new Date().toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'working'
      };

      const features = algorithm.calculateFeatures(memory, 3, 10);
      expect(features.duplication_ratio).toBe(0.3);
    });

    it('totalMemories가 0일 때 중복 비율을 0으로 처리해야 함', () => {
      const memory = {
        created_at: new Date().toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'working'
      };

      const features = algorithm.calculateFeatures(memory, 5, 0);
      expect(features.duplication_ratio).toBe(0);
    });
  });

  describe('calculateRecency', () => {
    it('최근 메모리는 높은 최근성을 가져야 함', () => {
      const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1일 전
      const features = algorithm.calculateFeatures({
        created_at: recentDate.toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'episodic'
      }, 0, 1);

      expect(features.recency).toBeGreaterThan(0.8);
    });

    it('오래된 메모리는 낮은 최근성을 가져야 함', () => {
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1년 전
      const features = algorithm.calculateFeatures({
        created_at: oldDate.toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'episodic'
      }, 0, 1);

      expect(features.recency).toBeLessThan(0.1);
    });

    it('타입별 반감기가 적용되어야 함', () => {
      const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3일 전
      
      const workingFeatures = algorithm.calculateFeatures({
        created_at: date.toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'working'
      }, 0, 1);

      const episodicFeatures = algorithm.calculateFeatures({
        created_at: date.toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'episodic'
      }, 0, 1);

      // working 메모리는 3일이면 상당히 오래된 것
      // episodic 메모리는 3일이면 비교적 최근
      expect(workingFeatures.recency).toBeLessThan(episodicFeatures.recency);
    });
  });

  describe('calculateUsage', () => {
    it('높은 사용 빈도는 높은 사용성을 가져야 함', () => {
      const features = algorithm.calculateFeatures({
        created_at: new Date().toISOString(),
        last_accessed: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'semantic',
        view_count: 100,
        cite_count: 50,
        edit_count: 10
      }, 0, 1);

      expect(features.usage).toBeGreaterThan(0.5);
    });

    it('낮은 사용 빈도는 낮은 사용성을 가져야 함', () => {
      const features = algorithm.calculateFeatures({
        created_at: new Date().toISOString(),
        importance: 0.5,
        pinned: false,
        type: 'semantic',
        view_count: 0,
        cite_count: 0,
        edit_count: 0
      }, 0, 1);

      expect(features.usage).toBeLessThan(0.3);
    });

    it('최근 접근은 높은 사용성을 가져야 함', () => {
      const features = algorithm.calculateFeatures({
        created_at: new Date().toISOString(),
        last_accessed: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1시간 전
        importance: 0.5,
        pinned: false,
        type: 'semantic',
        view_count: 0,
        cite_count: 0,
        edit_count: 0
      }, 0, 1);

      expect(features.usage).toBeGreaterThan(0.5);
    });
  });

  describe('analyzeForgetCandidates', () => {
    it('여러 메모리를 분석하고 점수순으로 정렬해야 함', () => {
      const memories = [
        {
          id: 'memory1',
          created_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1년 전
          importance: 0.2,
          pinned: false,
          type: 'episodic',
          view_count: 0,
          cite_count: 0,
          edit_count: 0
        },
        {
          id: 'memory2',
          created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1일 전
          importance: 0.8,
          pinned: true,
          type: 'semantic',
          view_count: 10,
          cite_count: 5,
          edit_count: 2
        },
        {
          id: 'memory3',
          created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30일 전
          importance: 0.4,
          pinned: false,
          type: 'episodic',
          view_count: 2,
          cite_count: 1,
          edit_count: 0
        }
      ];

      const results = algorithm.analyzeForgetCandidates(memories);
      
      expect(results).toHaveLength(3);
      expect(results[0].memory_id).toBe('memory1'); // 가장 높은 망각 점수
      expect(results[0].forget_score).toBeGreaterThan(results[1].forget_score);
      expect(results[1].forget_score).toBeGreaterThan(results[2].forget_score);
    });

    it('빈 배열을 처리해야 함', () => {
      const results = algorithm.analyzeForgetCandidates([]);
      expect(results).toHaveLength(0);
    });

    it('각 결과에 올바른 정보를 포함해야 함', () => {
      const memories = [{
        id: 'test-memory',
        created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        importance: 0.3,
        pinned: false,
        type: 'working',
        view_count: 1,
        cite_count: 0,
        edit_count: 0
      }];

      const results = algorithm.analyzeForgetCandidates(memories);
      const result = results[0];
      
      expect(result.memory_id).toBe('test-memory');
      expect(result.forget_score).toBeGreaterThan(0);
      expect(typeof result.should_forget).toBe('boolean');
      expect(typeof result.reason).toBe('string');
      expect(result.features).toBeDefined();
      expect(result.features.recency).toBeGreaterThan(0);
      expect(result.features.usage).toBeGreaterThanOrEqual(0);
      expect(result.features.duplication_ratio).toBeGreaterThanOrEqual(0);
      expect(result.features.importance).toBe(0.3);
      expect(result.features.pinned).toBe(false);
    });

    it('중복 계산을 수행해야 함', () => {
      const memories = [
        {
          id: 'memory1',
          created_at: new Date().toISOString(),
          importance: 0.5,
          pinned: false,
          type: 'episodic'
        },
        {
          id: 'memory2',
          created_at: new Date().toISOString(),
          importance: 0.5,
          pinned: false,
          type: 'episodic'
        },
        {
          id: 'memory3',
          created_at: new Date().toISOString(),
          importance: 0.5,
          pinned: false,
          type: 'semantic'
        }
      ];

      const results = algorithm.analyzeForgetCandidates(memories);
      
      // episodic 타입은 2개이므로 중복 비율이 높아야 함
      const episodicResults = results.filter(r => r.memory_id === 'memory1' || r.memory_id === 'memory2');
      episodicResults.forEach(result => {
        expect(result.features.duplication_ratio).toBeGreaterThan(0);
      });
      
      // semantic 타입은 1개이므로 중복 비율이 낮아야 함
      const semanticResult = results.find(r => r.memory_id === 'memory3');
      expect(semanticResult?.features.duplication_ratio).toBe(0);
    });
  });

  describe('엣지 케이스', () => {
    it('극단적인 특징 값들을 처리해야 함', () => {
      const extremeFeatures: ForgettingFeatures = {
        recency: 0,
        usage: 0,
        duplication_ratio: 1,
        importance: 0,
        pinned: false
      };

      const score = algorithm.calculateForgetScore(extremeFeatures);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(2); // 합리적인 범위 내
    });

    it('모든 특징이 최적값일 때 낮은 망각 점수를 가져야 함', () => {
      const optimalFeatures: ForgettingFeatures = {
        recency: 1,
        usage: 1,
        duplication_ratio: 0,
        importance: 1,
        pinned: true
      };

      const score = algorithm.calculateForgetScore(optimalFeatures);
      expect(score).toBeLessThan(0);
    });

    it('사용자 정의 가중치가 올바르게 적용되어야 함', () => {
      const customWeights = {
        recency: 0.5,
        usage: 0.3,
        duplication: 0.1,
        importance: 0.05,
        pinned: 0.05
      };
      
      const customAlgorithm = new ForgettingAlgorithm(customWeights);
      const features: ForgettingFeatures = {
        recency: 0.5,
        usage: 0.5,
        duplication_ratio: 0.5,
        importance: 0.5,
        pinned: false
      };

      const score = customAlgorithm.calculateForgetScore(features);
      const expectedScore = 0.5 * 0.5 + 0.3 * 0.5 + 0.1 * 0.5 - 0.05 * 0.5 - 0.05 * 0;
      expect(score).toBeCloseTo(expectedScore, 3);
    });
  });
});
