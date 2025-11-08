/**
 * Consolidation Score Service
 * Hou et al. 정규화 회상 확률 공식을 기반으로 동적 기억 통합 점수를 계산합니다.
 * 
 * 공식:
 * - p_n(t) = (1 - exp(-r * e^(-t/g_n))) / (1 - e^(-1))
 * - g_n = g_{n-1} + S(t)
 * - S(t) = (1 - e^(-t)) / (1 + e^(-t))
 * - g_0 = 1
 */

import type {
  ConsolidationScoreInput,
  ConsolidationScoreResult,
  GValueUpdateInput,
  MemoryType
} from '../types/consolidation-score.types.js';

/**
 * 타입별 초기 회상 확률 상수 (r_base)
 */
const R_BASE_BY_TYPE: Record<MemoryType, number> = {
  procedural: 0.6,  // 절차 기억은 더 오래 유지
  episodic: 0.5,     // 기본값
  semantic: 0.5,      // 기본값
  working: 0.5        // 기본값
};

/**
 * 핀 고정 메모리 최소 바닥값
 */
const PINNED_MIN_SCORE = 0.25;

/**
 * 정규화 상수 (1 - e^(-1))
 */
const NORMALIZATION_CONSTANT = 1 - Math.exp(-1);

/**
 * Consolidation Score Service
 */
export class ConsolidationScoreService {
  /**
   * S(t) 함수 구현: (1 - e^(-t)) / (1 + e^(-t))
   * 
   * @param t 경과 시간 (시간 단위)
   * @returns S(t) 값
   */
  calculateS(t: number): number {
    if (t < 0) {
      throw new Error('Time elapsed must be non-negative');
    }

    const expNegT = Math.exp(-t);
    const numerator = 1 - expNegT;
    const denominator = 1 + expNegT;

    return numerator / denominator;
  }

  /**
   * g_n 계산 로직: g_n = g_{n-1} + S(t)
   * 
   * @param input g_value 업데이트 입력 파라미터
   * @returns 업데이트된 g_value
   */
  updateGValue(input: GValueUpdateInput): number {
    const { previousGValue, timeElapsed } = input;

    // g_0 = 1 (초기값)
    const gPrevious = previousGValue ?? 1.0;

    // S(t) 계산
    const s = this.calculateS(timeElapsed);

    // g_n = g_{n-1} + S(t)
    return gPrevious + s;
  }

  /**
   * 타입별 초기 회상 확률 상수 (r_base) 조회
   * 
   * @param type 메모리 타입
   * @returns r_base 값
   */
  getRBaseForType(type: MemoryType): number {
    return R_BASE_BY_TYPE[type];
  }

  /**
   * Hou et al. 정규화 회상 확률 공식 구현
   * p_n(t) = (1 - exp(-r * e^(-t/g_n))) / (1 - e^(-1))
   * 
   * @param r 초기 회상 확률 상수
   * @param t 경과 시간 (시간 단위)
   * @param gN 감쇠 상수 g_n
   * @returns 정규화된 회상 확률 (0.0 ~ 1.0)
   */
  calculateRecallProbability(r: number, t: number, gN: number): number {
    if (t < 0) {
      throw new Error('Time elapsed must be non-negative');
    }
    if (gN <= 0) {
      throw new Error('g_n must be positive');
    }

    // e^(-t/g_n)
    const expNegTOverGN = Math.exp(-t / gN);

    // -r * e^(-t/g_n)
    const negRExp = -r * expNegTOverGN;

    // 1 - exp(-r * e^(-t/g_n))
    const numerator = 1 - Math.exp(negRExp);

    // 정규화: (1 - exp(-r * e^(-t/g_n))) / (1 - e^(-1))
    const probability = numerator / NORMALIZATION_CONSTANT;

    // 클램핑: 0.0 ~ 1.0
    return Math.max(0.0, Math.min(1.0, probability));
  }

  /**
   * 경과 시간 계산 (시간 단위)
   * 
   * @param lastAccessedAt 마지막 접근 시간 (NULL인 경우 createdAt 사용)
   * @param createdAt 생성 시간
   * @param now 현재 시간 (기본값: 현재 시각)
   * @returns 경과 시간 (시간 단위)
   */
  calculateTimeElapsed(
    lastAccessedAt: Date | null,
    createdAt: Date,
    now: Date = new Date()
  ): number {
    const referenceTime = lastAccessedAt ?? createdAt;
    const diffMs = now.getTime() - referenceTime.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    return Math.max(0, diffHours);
  }

  /**
   * g_value 재계산 (g_value가 NULL인 경우)
   * recall_count를 기반으로 처음부터 계산
   * 
   * @param recallCount 회상 횟수
   * @param timeElapsed 경과 시간 (시간 단위)
   * @returns 계산된 g_value
   */
  recalculateGValue(recallCount: number, timeElapsed: number): number {
    if (recallCount < 0) {
      throw new Error('Recall count must be non-negative');
    }

    // g_0 = 1
    let gN = 1.0;

    // recall_count만큼 반복하여 g_n 계산
    // 실제로는 각 recall 시점의 시간 경과를 알아야 정확하지만,
    // 마이그레이션된 기존 데이터의 경우 근사값으로 현재 시간 경과를 사용
    for (let n = 1; n <= recallCount; n++) {
      // 각 recall 시점의 시간 경과를 근사 (균등 분배 가정)
      const tForRecall = timeElapsed / (recallCount + 1) * (recallCount - n + 1);
      const s = this.calculateS(tForRecall);
      gN = gN + s;
    }

    return gN;
  }

  /**
   * Consolidation Score 계산
   * 
   * @param input 계산 입력 파라미터
   * @returns 계산 결과
   */
  calculateScore(input: ConsolidationScoreInput): ConsolidationScoreResult {
    const {
      recallCount,
      lastAccessedAt,
      createdAt,
      gValue,
      type,
      pinned
    } = input;

    // 경과 시간 계산
    const timeElapsed = this.calculateTimeElapsed(lastAccessedAt, createdAt);

    // g_value 결정
    let gN: number;
    if (gValue !== null) {
      // 저장된 g_value 사용
      gN = gValue;
    } else {
      // g_value가 NULL인 경우 재계산
      gN = this.recalculateGValue(recallCount, timeElapsed);
    }

    // 타입별 r_base 조회
    const rBase = this.getRBaseForType(type);

    // Hou et al. 공식으로 점수 계산
    let score = this.calculateRecallProbability(rBase, timeElapsed, gN);

    // 핀 고정 메모리 최소값 보장
    if (pinned && score < PINNED_MIN_SCORE) {
      score = PINNED_MIN_SCORE;
    }

    // 점수 클램핑 (0.0 ~ 1.0)
    score = Math.max(0.0, Math.min(1.0, score));

    return {
      score,
      gValue: gN
    };
  }

  /**
   * g_value 업데이트 (recall_count 증가 시 호출)
   * 
   * @param input g_value 업데이트 입력 파라미터
   * @returns 업데이트된 g_value
   */
  updateGValueForRecall(input: GValueUpdateInput): number {
    return this.updateGValue(input);
  }
}

