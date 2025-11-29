/**
 * Consolidation Score Service 테스트
 */

// Mock @xenova/transformers to prevent onnxruntime-node loading
// MUST be at the top before any imports
import { vi } from 'vitest';
vi.mock('@xenova/transformers', () => {
  return {
    pipeline: vi.fn().mockResolvedValue({
      __call: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    }),
    env: {
      useBrowserCache: false,
      useCustomCache: false
    }
  };
});

// onnxruntime-node 모킹 (네이티브 바인딩 로딩 실패 방지)
vi.mock('onnxruntime-node', () => ({
  InferenceSession: vi.fn(),
  Tensor: vi.fn()
}));

// sharp 모킹 (이미지 처리 라이브러리 로딩 실패 방지)
vi.mock('sharp', () => ({
  default: vi.fn()
}));

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConsolidationScoreService } from '../infrastructure/consolidation-score-service.js';
import type {
  ConsolidationScoreInput,
  GValueUpdateInput,
  MemoryType
} from '../shared/types/consolidation-score.types.js';

describe('ConsolidationScoreService', () => {
  let service: ConsolidationScoreService;

  beforeEach(() => {
    service = new ConsolidationScoreService();
  });

  afterEach(() => {
    // 인스턴스 정리
    if (service) {
      service = null as any;
    }
    // Mock 정리
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('calculateS', () => {
    it('should calculate S(t) correctly for t=0', () => {
      const result = service.calculateS(0);
      expect(result).toBe(0);
    });

    it('should calculate S(t) correctly for t=1', () => {
      const result = service.calculateS(1);
      // S(1) = (1 - e^(-1)) / (1 + e^(-1))
      const expected = (1 - Math.exp(-1)) / (1 + Math.exp(-1));
      expect(result).toBeCloseTo(expected, 10);
    });

    it('should calculate S(t) correctly for large t', () => {
      const result = service.calculateS(100);
      // 큰 t에 대해 S(t)는 1에 가까워짐
      expect(result).toBeGreaterThan(0.9);
      expect(result).toBeLessThanOrEqual(1.0);
    });

    it('should throw error for negative t', () => {
      expect(() => service.calculateS(-1)).toThrow('Time elapsed must be non-negative');
    });
  });

  describe('updateGValue', () => {
    it('should calculate g_1 from g_0=1', () => {
      const input: GValueUpdateInput = {
        previousGValue: 1.0,
        timeElapsed: 1.0
      };
      const result = service.updateGValue(input);
      const s = service.calculateS(1.0);
      expect(result).toBeCloseTo(1.0 + s, 10);
    });

    it('should use g_0=1 when previousGValue is null', () => {
      const input: GValueUpdateInput = {
        previousGValue: null,
        timeElapsed: 1.0
      };
      const result = service.updateGValue(input);
      const s = service.calculateS(1.0);
      expect(result).toBeCloseTo(1.0 + s, 10);
    });

    it('should calculate g_n incrementally', () => {
      // g_0 = 1
      let gN = 1.0;
      const timeElapsed = 1.0;

      // g_1 = g_0 + S(1)
      gN = service.updateGValue({ previousGValue: gN, timeElapsed });
      const g1 = gN;

      // g_2 = g_1 + S(1)
      gN = service.updateGValue({ previousGValue: gN, timeElapsed });
      const g2 = gN;

      expect(g2).toBeGreaterThan(g1);
    });
  });

  describe('getRBaseForType', () => {
    it('should return 0.6 for procedural type', () => {
      const result = service.getRBaseForType('procedural');
      expect(result).toBe(0.6);
    });

    it('should return 0.5 for episodic type', () => {
      const result = service.getRBaseForType('episodic');
      expect(result).toBe(0.5);
    });

    it('should return 0.5 for semantic type', () => {
      const result = service.getRBaseForType('semantic');
      expect(result).toBe(0.5);
    });

    it('should return 0.5 for working type', () => {
      const result = service.getRBaseForType('working');
      expect(result).toBe(0.5);
    });
  });

  describe('calculateRecallProbability', () => {
    it('should calculate probability for t=0', () => {
      const result = service.calculateRecallProbability(0.5, 0, 1.0);
      // t=0일 때: p_n(0) = (1 - exp(-r)) / (1 - e^(-1))
      const expected = (1 - Math.exp(-0.5)) / (1 - Math.exp(-1));
      expect(result).toBeCloseTo(expected, 10);
    });

    it('should return higher probability for procedural type (r=0.6)', () => {
      const procedural = service.calculateRecallProbability(0.6, 1.0, 1.0);
      const episodic = service.calculateRecallProbability(0.5, 1.0, 1.0);
      expect(procedural).toBeGreaterThan(episodic);
    });

    it('should return lower probability for larger t', () => {
      const recent = service.calculateRecallProbability(0.5, 1.0, 1.0);
      const old = service.calculateRecallProbability(0.5, 100.0, 1.0);
      expect(recent).toBeGreaterThan(old);
    });

    it('should return higher probability for larger g_n', () => {
      const smallG = service.calculateRecallProbability(0.5, 10.0, 1.0);
      const largeG = service.calculateRecallProbability(0.5, 10.0, 10.0);
      expect(largeG).toBeGreaterThan(smallG);
    });

    it('should throw error for negative t', () => {
      expect(() => service.calculateRecallProbability(0.5, -1, 1.0)).toThrow(
        'Time elapsed must be non-negative'
      );
    });

    it('should throw error for non-positive g_n', () => {
      expect(() => service.calculateRecallProbability(0.5, 1.0, 0)).toThrow(
        'g_n must be positive'
      );
      expect(() => service.calculateRecallProbability(0.5, 1.0, -1)).toThrow(
        'g_n must be positive'
      );
    });

    it('should return value in [0, 1] range', () => {
      const result = service.calculateRecallProbability(0.5, 100.0, 1.0);
      expect(result).toBeGreaterThanOrEqual(0.0);
      expect(result).toBeLessThanOrEqual(1.0);
    });
  });

  describe('calculateTimeElapsed', () => {
    it('should calculate time elapsed from lastAccessedAt', () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const result = service.calculateTimeElapsed(oneHourAgo, new Date(0), now);
      expect(result).toBeCloseTo(1.0, 2);
    });

    it('should use createdAt when lastAccessedAt is null', () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const result = service.calculateTimeElapsed(null, oneDayAgo, now);
      expect(result).toBeCloseTo(24.0, 2);
    });

    it('should return 0 for future dates', () => {
      const now = new Date();
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const result = service.calculateTimeElapsed(future, new Date(0), now);
      expect(result).toBe(0);
    });
  });

  describe('recalculateGValue', () => {
    it('should return g_0=1 for recallCount=0', () => {
      const result = service.recalculateGValue(0, 1.0);
      expect(result).toBe(1.0);
    });

    it('should calculate g_n for recallCount=1', () => {
      const result = service.recalculateGValue(1, 1.0);
      expect(result).toBeGreaterThan(1.0);
    });

    it('should calculate g_n for recallCount>1', () => {
      const result = service.recalculateGValue(5, 10.0);
      expect(result).toBeGreaterThan(1.0);
    });

    it('should throw error for negative recallCount', () => {
      expect(() => service.recalculateGValue(-1, 1.0)).toThrow(
        'Recall count must be non-negative'
      );
    });
  });

  describe('calculateScore', () => {
    const createInput = (overrides: Partial<ConsolidationScoreInput> = {}): ConsolidationScoreInput => {
      const now = new Date();
      return {
        recallCount: 1,
        lastAccessedAt: now,
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        gValue: 1.0,
        type: 'episodic',
        pinned: false,
        ...overrides
      };
    };

    it('should calculate score for basic input', () => {
      const input = createInput();
      const result = service.calculateScore(input);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
      expect(result.gValue).toBeGreaterThan(0);
    });

    it('should use gValue when provided', () => {
      const input = createInput({ gValue: 2.0 });
      const result = service.calculateScore(input);
      expect(result.gValue).toBe(2.0);
    });

    it('should recalculate gValue when null', () => {
      const now = new Date();
      const input = createInput({
        gValue: null,
        recallCount: 3,
        lastAccessedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 24시간 전
        createdAt: new Date(now.getTime() - 48 * 60 * 60 * 1000) // 48시간 전
      });
      const result = service.calculateScore(input);
      // recallCount=3이면 최소한 g_0 + S(t) 이상이어야 함
      expect(result.gValue).toBeGreaterThanOrEqual(1.0);
    });

    it('should use createdAt when lastAccessedAt is null', () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const input = createInput({
        lastAccessedAt: null,
        createdAt: oneDayAgo
      });
      const result = service.calculateScore(input);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should return higher score for procedural type', () => {
      const episodic = service.calculateScore(createInput({ type: 'episodic' }));
      const procedural = service.calculateScore(createInput({ type: 'procedural' }));
      expect(procedural.score).toBeGreaterThan(episodic.score);
    });

    it('should guarantee minimum score for pinned memories', () => {
      const input = createInput({ pinned: true });
      // 매우 오래된 메모리로 설정하여 점수가 낮아지도록 함
      const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const oldInput = createInput({
        pinned: true,
        lastAccessedAt: veryOld,
        createdAt: veryOld
      });
      const result = service.calculateScore(oldInput);
      expect(result.score).toBeGreaterThanOrEqual(0.25);
    });

    it('should clamp score to [0, 1] range', () => {
      const input = createInput();
      const result = service.calculateScore(input);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should return higher score for recent memories', () => {
      const now = new Date();
      const recent = createInput({
        lastAccessedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1시간 전
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000)
      });
      const old = createInput({
        lastAccessedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7일 전
        createdAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
      });
      const recentResult = service.calculateScore(recent);
      const oldResult = service.calculateScore(old);
      expect(recentResult.score).toBeGreaterThan(oldResult.score);
    });

    it('should return higher score for higher recallCount with same time elapsed', () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      // gValue를 null로 설정하여 recallCount에 따라 재계산되도록 함
      const lowRecall = createInput({
        recallCount: 1,
        gValue: null,
        lastAccessedAt: oneDayAgo,
        createdAt: oneDayAgo
      });
      const highRecall = createInput({
        recallCount: 10,
        gValue: null,
        lastAccessedAt: oneDayAgo,
        createdAt: oneDayAgo
      });
      const lowResult = service.calculateScore(lowRecall);
      const highResult = service.calculateScore(highRecall);
      // 높은 recall_count는 더 높은 g_value를 가지므로 더 높은 점수
      // 단, 시간 경과가 같고 recall_count만 다르면 g_value가 더 커지므로 점수가 높아짐
      expect(highResult.gValue).toBeGreaterThan(lowResult.gValue);
      // g_value가 높으면 일반적으로 점수도 높아짐 (시간 경과가 같을 때)
      expect(highResult.score).toBeGreaterThanOrEqual(lowResult.score);
    });
  });

  describe('updateGValueForRecall', () => {
    it('should update g_value correctly', () => {
      const input: GValueUpdateInput = {
        previousGValue: 1.0,
        timeElapsed: 1.0
      };
      const result = service.updateGValueForRecall(input);
      const expected = service.updateGValue(input);
      expect(result).toBe(expected);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero time elapsed', () => {
      const now = new Date();
      const input: ConsolidationScoreInput = {
        recallCount: 1,
        lastAccessedAt: now,
        createdAt: now,
        gValue: 1.0,
        type: 'episodic',
        pinned: false
      };
      const result = service.calculateScore(input);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should handle very large time elapsed', () => {
      const now = new Date();
      const veryOld = new Date(0); // 1970-01-01
      const input: ConsolidationScoreInput = {
        recallCount: 1,
        lastAccessedAt: veryOld,
        createdAt: veryOld,
        gValue: 1.0,
        type: 'episodic',
        pinned: false
      };
      const result = service.calculateScore(input);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });

    it('should handle very large recallCount', () => {
      const now = new Date();
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      const input: ConsolidationScoreInput = {
        recallCount: 1000,
        lastAccessedAt: now,
        createdAt: oneYearAgo,
        gValue: null, // 재계산 필요
        type: 'episodic',
        pinned: false
      };
      const result = service.calculateScore(input);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
      // recallCount=1000이면 g_value는 최소한 1.0 이상이어야 함
      expect(result.gValue).toBeGreaterThanOrEqual(1.0);
    });

    it('should handle recallCount=0', () => {
      const now = new Date();
      const input: ConsolidationScoreInput = {
        recallCount: 0,
        lastAccessedAt: null,
        createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        gValue: null,
        type: 'episodic',
        pinned: false
      };
      const result = service.calculateScore(input);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
      expect(result.gValue).toBe(1.0); // g_0 = 1
    });

    it('should handle all memory types', () => {
      const types: MemoryType[] = ['working', 'episodic', 'semantic', 'procedural'];
      const now = new Date();
      
      for (const type of types) {
        const input: ConsolidationScoreInput = {
          recallCount: 1,
          lastAccessedAt: now,
          createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          gValue: 1.0,
          type,
          pinned: false
        };
        const result = service.calculateScore(input);
        expect(result.score).toBeGreaterThanOrEqual(0.0);
        expect(result.score).toBeLessThanOrEqual(1.0);
      }
    });

    it('should handle boundary values for score clamping', () => {
      // 점수가 1.0을 초과하거나 0.0 미만으로 계산되는 경우를 테스트
      // 실제로는 공식이 [0, 1] 범위를 보장하지만, 클램핑 로직이 제대로 작동하는지 확인
      const now = new Date();
      const input: ConsolidationScoreInput = {
        recallCount: 1,
        lastAccessedAt: now,
        createdAt: now,
        gValue: 1.0,
        type: 'episodic',
        pinned: false
      };
      const result = service.calculateScore(input);
      expect(result.score).toBeGreaterThanOrEqual(0.0);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });
  });
});

