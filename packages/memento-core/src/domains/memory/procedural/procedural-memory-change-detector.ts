/**
 * Procedural Memory 변경 감지 유틸리티
 * 
 * 이 유틸리티는 Procedural Memory의 변경 사항을 감지하고 분류합니다.
 * PRD FR4: 판정 기준 구현을 위한 유틸리티 함수 제공
 * 
 * 주요 기능:
 * - Procedural Memory 스냅샷 생성
 * - 변경 타입 분류 (version_created, steps_modified, metadata_modified, content_modified, reflection_added, deleted, none)
 * - JSON 정규화 및 해시 계산
 */

import { createHash } from 'crypto';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';

/**
 * Procedural Memory 스냅샷 인터페이스
 * 
 * 변경 감지를 위해 필요한 모든 필드를 포함합니다.
 * memory_item 테이블과 memory_link 테이블의 version_of 관계를 조합하여 생성됩니다.
 */
export interface ProceduralMemorySnapshot {
  /** 메모리 ID */
  id: string | null;
  /** 메모리 내용 */
  content: string | null;
  /** 중요도 (0-1) */
  importance: number | null;
  /** 프라이버시 범위 */
  privacy_scope: string | null;
  /** 프로세스 이름 */
  workflow_name: string | null;
  /** 기술/능력 이름 */
  skill_name: string | null;
  /** steps JSON 배열의 해시값 */
  steps_hash: string | null;
  /** trigger_conditions JSON 객체의 해시값 */
  trigger_conditions_hash: string | null;
  /** 작업 목표 */
  task_goal: string | null;
  /** reflection_notes 배열의 길이 (JSON 파싱 후) */
  reflection_notes_count: number | null;
  /** 편집 횟수 */
  edit_count: number | null;
  /** version_of 관계의 target_id (memory_link에서 조회) */
  version_of_target_id: string | null;
}

/**
 * 변경 타입 열거형
 * 
 * PRD FR4 기반 판정 기준:
 * - version_created: versioned 모드로 새 버전 생성
 * - steps_modified: steps JSON 배열 변경
 * - metadata_modified: workflow_name, skill_name, trigger_conditions_hash, task_goal, edit_count 변경
 * - content_modified: content 필드 변경
 * - reflection_added: reflection_notes 배열 길이 증가
 * - deleted: 메모리 삭제
 * - none: 변경 없음
 */
export type ChangeType =
  | 'version_created'
  | 'steps_modified'
  | 'metadata_modified'
  | 'content_modified'
  | 'reflection_added'
  | 'deleted'
  | 'none';

/**
 * 변경 감지 결과 인터페이스
 * 
 * 변경 여부와 변경 타입, 상세 변경 내역을 포함합니다.
 */
export interface ChangeDetectionResult {
  /** 변경 여부 */
  hasChanged: boolean;
  /** 변경 타입 */
  changeType: ChangeType;
  /** 변경된 필드 목록 (디버깅 및 로깅용) */
  changedFields: string[];
  /** 변경 전 스냅샷 */
  before: ProceduralMemorySnapshot | null;
  /** 변경 후 스냅샷 */
  after: ProceduralMemorySnapshot | null;
}

/**
 * JSON 정규화 유틸리티 함수
 * 
 * 해시 계산을 위해 일관된 JSON 문자열을 생성합니다.
 * 
 * 정규화 규칙:
 * - 객체의 키를 알파벳 순서로 정렬
 * - 숫자는 일관된 형식으로 직렬화 (JSON.stringify의 기본 동작 사용)
 * - 배열의 순서는 유지 (배열은 순서가 중요하므로 정렬하지 않음)
 * - null 값은 "null" 문자열로 처리
 * - undefined는 제외 (객체에서 undefined 필드는 제외됨)
 * 
 * @param value - 정규화할 값 (객체, 배열, 원시 타입)
 * @returns 정규화된 JSON 문자열
 */
export function normalizeJson(value: unknown): string {
  // null 처리
  if (value === null) {
    return 'null';
  }

  // undefined 처리 (null로 변환)
  if (value === undefined) {
    return 'null';
  }

  // 원시 타입 처리 (JSON.stringify 사용)
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  // 배열 처리 (순서 유지, 재귀적으로 정규화)
  if (Array.isArray(value)) {
    const normalizedItems = value.map(item => normalizeJson(item));
    return `[${normalizedItems.join(',')}]`;
  }

  // 객체 처리 (키 정렬, 재귀적으로 정규화)
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const normalizedPairs: string[] = [];

    for (const key of sortedKeys) {
      const val = obj[key];
      // undefined 필드는 제외 (일관된 해시를 위해)
      if (val !== undefined) {
        const normalizedValue = normalizeJson(val);
        // 키와 값을 JSON 형식으로 직렬화
        normalizedPairs.push(`${JSON.stringify(key)}:${normalizedValue}`);
      }
    }

    return `{${normalizedPairs.join(',')}}`;
  }

  // 예상치 못한 타입은 null로 처리
  return 'null';
}

/**
 * JSON 문자열의 SHA-256 해시 계산
 * 
 * 해시 계산 전에 JSON을 정규화하여 일관된 해시값을 생성합니다.
 * 
 * 처리 규칙:
 * - `jsonString === null`: `"null"` 문자열을 해시 (SHA-256 hash of `"null"`)
 * - `jsonString === ""` (빈 문자열): 빈 문자열을 해시 (SHA-256 hash of `""`)
 * - `jsonString === "null"` (문자열 "null"): JSON 파싱 시도 → `null`로 파싱되면 정규화 후 해시, 실패 시 원문 해시
 * - 일반 JSON 문자열: JSON 파싱 → 정규화 → 해시
 * - 파싱 실패 시: 원문 문자열을 해시 (fallback)
 * 
 * **일관성**: null 입력과 "null" 문자열 입력은 다른 해시값을 반환
 * - null → "null" 문자열 해시
 * - "null" → JSON 파싱 후 정규화된 해시
 * 
 * @param jsonString - 해시할 JSON 문자열 (또는 null)
 * @returns SHA-256 해시값 (hex 문자열)
 */
export function computeJsonHash(jsonString: string | null): string {
  // null 처리: "null" 문자열을 해시
  if (jsonString === null) {
    const hash = createHash('sha256');
    hash.update('null');
    return hash.digest('hex');
  }

  // 빈 문자열 처리: 빈 문자열을 해시
  if (jsonString === '') {
    const hash = createHash('sha256');
    hash.update('');
    return hash.digest('hex');
  }

  // 문자열 "null" 처리: JSON 파싱 시도
  if (jsonString === 'null') {
    try {
      const parsed = JSON.parse(jsonString);
      // null로 파싱되면 정규화 후 해시
      const normalized = normalizeJson(parsed);
      const hash = createHash('sha256');
      hash.update(normalized);
      return hash.digest('hex');
    } catch {
      // 파싱 실패 시 원문 해시 (fallback)
      const hash = createHash('sha256');
      hash.update(jsonString);
      return hash.digest('hex');
    }
  }

  // 일반 JSON 문자열 처리: JSON 파싱 → 정규화 → 해시
  try {
    const parsed = JSON.parse(jsonString);
    const normalized = normalizeJson(parsed);
    const hash = createHash('sha256');
    hash.update(normalized);
    return hash.digest('hex');
  } catch {
    // 파싱 실패 시 원문 문자열을 해시 (fallback)
    const hash = createHash('sha256');
    hash.update(jsonString);
    return hash.digest('hex');
  }
}

/**
 * reflection_notes JSON 문자열의 배열 길이 계산
 * 
 * @param reflectionNotes - reflection_notes JSON 문자열 (또는 null)
 * @returns 배열 길이 (파싱 실패 시 null)
 */
function computeReflectionNotesCount(reflectionNotes: string | null): number | null {
  if (reflectionNotes === null || reflectionNotes === '') {
    return null;
  }

  try {
    const parsed = JSON.parse(reflectionNotes);
    // 배열인 경우 길이 반환
    if (Array.isArray(parsed)) {
      return parsed.length;
    }
    // 단일 객체인 경우 1 반환 (Phase 1 호환성)
    if (typeof parsed === 'object' && parsed !== null) {
      return 1;
    }
    // 예상치 못한 타입
    return null;
  } catch {
    // 파싱 실패 시 null 반환
    return null;
  }
}

/**
 * Procedural Memory 스냅샷 생성
 * 
 * memory_item 테이블에서 메모리를 조회하고, memory_link 테이블에서 version_of 관계를 조회하여
 * 변경 감지에 필요한 모든 정보를 포함한 스냅샷을 생성합니다.
 * 
 * @param db - 데이터베이스 인스턴스
 * @param memoryId - 메모리 ID
 * @returns ProceduralMemorySnapshot 또는 null (메모리가 없거나 procedural 타입이 아닌 경우)
 */
export function createProceduralMemorySnapshot(
  db: Database.Database,
  memoryId: string
): ProceduralMemorySnapshot | null {
  // memory_item 테이블에서 메모리 조회
  const memory = DatabaseUtils.get(
    db,
    `SELECT 
      id, content, importance, privacy_scope, workflow_name, skill_name,
      steps, trigger_conditions, task_goal, reflection_notes, edit_count, last_accessed
    FROM memory_item
    WHERE id = ? AND type = 'procedural'`,
    [memoryId]
  ) as {
    id: string;
    content: string;
    importance: number | null;
    privacy_scope: string | null;
    workflow_name: string | null;
    skill_name: string | null;
    steps: string | null;
    trigger_conditions: string | null;
    task_goal: string | null;
    reflection_notes: string | null;
    edit_count: number | null;
    last_accessed: string | null;
  } | undefined;

  // 메모리가 없거나 procedural 타입이 아닌 경우 null 반환
  if (!memory) {
    return null;
  }

  // memory_link 테이블에서 version_of 관계 조회
  // source_id가 현재 메모리 id이고 relation_type이 'version_of'인 경우
  const versionLink = DatabaseUtils.get(
    db,
    `SELECT target_id
    FROM memory_link
    WHERE source_id = ? AND relation_type = 'version_of'
    LIMIT 1`,
    [memoryId]
  ) as { target_id: string } | undefined;

  // steps와 trigger_conditions 해시 계산
  const stepsHash = computeJsonHash(memory.steps);
  const triggerConditionsHash = computeJsonHash(memory.trigger_conditions);

  // reflection_notes 배열 길이 계산
  const reflectionNotesCount = computeReflectionNotesCount(memory.reflection_notes);

  // 스냅샷 생성
  return {
    id: memory.id,
    content: memory.content,
    importance: memory.importance,
    privacy_scope: memory.privacy_scope,
    workflow_name: memory.workflow_name,
    skill_name: memory.skill_name,
    steps_hash: stepsHash,
    trigger_conditions_hash: triggerConditionsHash,
    task_goal: memory.task_goal,
    reflection_notes_count: reflectionNotesCount,
    edit_count: memory.edit_count ?? 0,
    version_of_target_id: versionLink?.target_id ?? null,
  };
}

/**
 * 두 값가 같은지 비교 (null 처리 포함)
 */
function isEqual(a: unknown, b: unknown): boolean {
  // 둘 다 null이거나 undefined인 경우
  if ((a === null || a === undefined) && (b === null || b === undefined)) {
    return true;
  }
  // 하나만 null이거나 undefined인 경우
  if ((a === null || a === undefined) || (b === null || b === undefined)) {
    return false;
  }
  // 값 비교
  return a === b;
}

/**
 * Procedural Memory 변경 감지
 * 
 * PRD FR4 기반 판정 기준에 따라 변경 여부와 변경 타입을 판정합니다.
 * 
 * 판정 우선순위:
 * 1. 경계값 처리 (null 체크)
 * 2. version_created
 * 3. steps_modified
 * 4. metadata_modified
 * 5. content_modified
 * 6. reflection_added
 * 7. deleted (경계값 처리에서 이미 처리됨)
 * 8. none
 * 
 * @param before - 변경 전 스냅샷 (또는 null)
 * @param after - 변경 후 스냅샷 (또는 null)
 * @returns 변경 감지 결과
 */
export function hasProceduralMemoryChanged(
  before: ProceduralMemorySnapshot | null,
  after: ProceduralMemorySnapshot | null
): ChangeDetectionResult {
  // 경계값 처리: 둘 다 null
  if (before === null && after === null) {
    return {
      hasChanged: false,
      changeType: 'none',
      changedFields: [],
      before: null,
      after: null,
    };
  }

  // 경계값 처리: 신규 생성 (before === null && after !== null)
  if (before === null && after !== null) {
    // versioned 모드로 생성된 경우
    if (after.version_of_target_id !== null) {
      return {
        hasChanged: true,
        changeType: 'version_created',
        changedFields: ['id', 'version_of_target_id'],
        before: null,
        after,
      };
    }
    // 단순 신규 생성 (메타데이터 변경으로 간주)
    return {
      hasChanged: true,
      changeType: 'metadata_modified',
      changedFields: ['id'],
      before: null,
      after,
    };
  }

  // 경계값 처리: 삭제 (before !== null && after === null)
  if (before !== null && after === null) {
    return {
      hasChanged: true,
      changeType: 'deleted',
      changedFields: ['id'],
      before,
      after: null,
    };
  }

  // 이제 before와 after가 모두 null이 아님을 보장
  // TypeScript 타입 가드를 위해 명시적 체크
  if (before === null || after === null) {
    // 이 경우는 발생하지 않아야 하지만 타입 안전성을 위해
    return {
      hasChanged: false,
      changeType: 'none',
      changedFields: [],
      before,
      after,
    };
  }

  // 변경된 필드 추적
  const changedFields: string[] = [];

  // version_created 체크: versioned 모드로 새 버전 생성
  if (
    before.version_of_target_id === null &&
    after.version_of_target_id !== null
  ) {
    changedFields.push('version_of_target_id');
    return {
      hasChanged: true,
      changeType: 'version_created',
      changedFields,
      before,
      after,
    };
  }

  // steps_modified 체크: steps_hash 변경
  if (!isEqual(before.steps_hash, after.steps_hash)) {
    changedFields.push('steps_hash');
    return {
      hasChanged: true,
      changeType: 'steps_modified',
      changedFields,
      before,
      after,
    };
  }

  // metadata_modified 체크: workflow_name, skill_name, trigger_conditions_hash, task_goal, edit_count 변경
  const metadataFields: Array<keyof ProceduralMemorySnapshot> = [
    'workflow_name',
    'skill_name',
    'trigger_conditions_hash',
    'task_goal',
    'edit_count',
  ];

  const metadataChanged = metadataFields.some((field) => {
    if (!isEqual(before[field], after[field])) {
      changedFields.push(field);
      return true;
    }
    return false;
  });

  if (metadataChanged) {
    return {
      hasChanged: true,
      changeType: 'metadata_modified',
      changedFields,
      before,
      after,
    };
  }

  // content_modified 체크: content 변경
  if (!isEqual(before.content, after.content)) {
    changedFields.push('content');
    return {
      hasChanged: true,
      changeType: 'content_modified',
      changedFields,
      before,
      after,
    };
  }

  // reflection_added 체크: reflection_notes_count 증가
  if (
    before.reflection_notes_count !== null &&
    after.reflection_notes_count !== null &&
    after.reflection_notes_count > before.reflection_notes_count
  ) {
    changedFields.push('reflection_notes_count');
    return {
      hasChanged: true,
      changeType: 'reflection_added',
      changedFields,
      before,
      after,
    };
  }

  // 모든 필드 비교 (나머지 필드들도 확인)
  const allFields: Array<keyof ProceduralMemorySnapshot> = [
    'id',
    'importance',
    'privacy_scope',
    'reflection_notes_count',
    'version_of_target_id',
  ];

  allFields.forEach((field) => {
    if (!isEqual(before[field], after[field])) {
      changedFields.push(field);
    }
  });

  // 변경이 감지되지 않은 경우
  if (changedFields.length === 0) {
    return {
      hasChanged: false,
      changeType: 'none',
      changedFields: [],
      before,
      after,
    };
  }

  // 예상치 못한 경우: 변경이 감지되었지만 위의 조건에 해당하지 않음
  // metadata_modified로 처리 (안전한 기본값)
  return {
    hasChanged: true,
    changeType: 'metadata_modified',
    changedFields,
    before,
    after,
  };
}

