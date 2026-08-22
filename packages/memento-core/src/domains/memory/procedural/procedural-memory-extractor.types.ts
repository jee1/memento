/**
 * Procedural Memory 추출기 공통 타입 및 인터페이스
 * 순환 참조 방지를 위해 추출기 구현체와 분리하여 정의
 */

import type { FailureEvent } from '../../../shared/types/failure-event.js';

/**
 * ReflectionNotes 인터페이스
 * reflection_notes 필드의 타입 안전성을 보장하기 위한 인터페이스
 */
export interface ReflectionNotes {
  original_task?: string;
  failure_type?: string;
  failure_description?: string;
  suggested_improvements?: string;
  lessons_learned?: string;
  timestamp?: string | Date;
  /** 추가 필드는 알려진 타입으로 제한해 타입 안정성 확보 */
  [key: string]: string | string[] | Date | undefined;
}

/**
 * 추출된 Procedural Memory 데이터
 */
export interface ExtractedProceduralMemory {
  workflow_name?: string;
  skill_name?: string;
  steps?: string; // JSON 배열 문자열
  trigger_conditions?: string; // JSON 객체 문자열
  task_goal?: string;
}

/**
 * Procedural Memory 추출기 플러그인 인터페이스.
 * LLM 추출 실패 시 null을 반환하여 fallback(규칙 기반)으로 넘긴다.
 */
export interface IProceduralMemoryExtractor {
  extract(
    notes: ReflectionNotes | Record<string, unknown>,
    event?: FailureEvent
  ): Promise<ExtractedProceduralMemory | null>;
}
