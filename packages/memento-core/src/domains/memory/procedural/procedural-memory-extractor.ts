/**
 * Procedural Memory Extractor 유틸리티 — 오케스트레이터
 * reflection_notes에서 procedural memory 필드 추출 및 변환
 *
 * 이 유틸리티는 reflexion-worker에서 생성된 reflection_notes를
 * procedural memory 형식(workflow_name, skill_name, steps, trigger_conditions)으로 변환합니다.
 */

import { logger } from '../../../shared/utils/logger.js';
import type { FailureEvent } from '../../../shared/types/failure-event.js';
import type { ReflectionNotes, ExtractedProceduralMemory } from './procedural-memory-extractor.types.js';
import type { IProceduralMemoryExtractor } from './procedural-memory-extractor.types.js';
import { extractProceduralMemory } from './procedural-memory-field-extractors.js';

// 하위 호환: 타입 re-export
export type { ReflectionNotes, ExtractedProceduralMemory } from './procedural-memory-extractor.types.js';

// 필드 추출 함수 re-export
export {
  extractWorkflowName,
  extractSkillName,
  extractSteps,
  generateTriggerConditions,
  extractProceduralMemory,
} from './procedural-memory-field-extractors.js';

// 유사도·병합 로직 re-export
export {
  type SimilarityMergeResult,
  calculateSimilarity,
  determineMergeStrategy,
} from './procedural-memory-similarity.js';

/**
 * 규칙 기반 Procedural Memory 추출기.
 * 기존 extractProceduralMemory를 래핑하여 IProceduralMemoryExtractor를 구현한다.
 * 항상 fallback으로 사용되며, 예외 시에만 null을 반환한다.
 */
export class RuleBasedProceduralExtractor implements IProceduralMemoryExtractor {
  async extract(
    notes: ReflectionNotes | Record<string, unknown>,
    event?: FailureEvent
  ): Promise<ExtractedProceduralMemory | null> {
    try {
      const result = extractProceduralMemory(notes, event);
      return result;
    } catch (err) {
      logger.debug('RuleBasedProceduralExtractor 추출 실패', {
        error: err instanceof Error ? err.message : err
      });
      return null;
    }
  }
}
