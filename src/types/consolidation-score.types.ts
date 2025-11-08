/**
 * Consolidation Score System 타입 정의
 */

/**
 * 메모리 타입
 */
export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';

/**
 * Consolidation Score 계산 입력 파라미터
 */
export interface ConsolidationScoreInput {
  /**
   * 회상 횟수 (recall_count)
   */
  recallCount: number;

  /**
   * 마지막 접근 시간 (last_accessed_at)
   * NULL인 경우 created_at을 사용
   */
  lastAccessedAt: Date | null;

  /**
   * 생성 시간 (created_at)
   * last_accessed_at이 NULL일 때 사용
   */
  createdAt: Date;

  /**
   * 현재 g_value (g_n)
   * NULL인 경우 recall_count를 기반으로 재계산
   */
  gValue: number | null;

  /**
   * 메모리 타입
   */
  type: MemoryType;

  /**
   * 핀 고정 여부
   */
  pinned: boolean;
}

/**
 * Consolidation Score 계산 결과
 */
export interface ConsolidationScoreResult {
  /**
   * 계산된 통합 점수 (0.0 ~ 1.0)
   */
  score: number;

  /**
   * 업데이트된 g_value (g_n)
   */
  gValue: number;
}

/**
 * g_value 업데이트 입력 파라미터
 */
export interface GValueUpdateInput {
  /**
   * 이전 g_value (g_{n-1})
   * NULL인 경우 g_0 = 1 사용
   */
  previousGValue: number | null;

  /**
   * 경과 시간 (시간 단위)
   */
  timeElapsed: number;
}

