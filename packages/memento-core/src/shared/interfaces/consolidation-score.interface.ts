/**
 * 통합 점수 서비스 인터페이스 (DIP)
 * 도메인/툴은 이 인터페이스만 참조하고, 인프라 구현체를 주입받음.
 */

import type {
  ConsolidationScoreInput,
  ConsolidationScoreResult,
  GValueUpdateInput
} from '../types/consolidation-score.types.js';

export interface IConsolidationScoreService {
  calculateScore(input: ConsolidationScoreInput): ConsolidationScoreResult;
  calculateTimeElapsed(lastAccessedAt: Date | null, createdAt: Date, now?: Date): number;
  updateGValueForRecall(input: GValueUpdateInput): number;
}
