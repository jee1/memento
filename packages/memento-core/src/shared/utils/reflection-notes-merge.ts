/**
 * Reflection Notes 병합 및 배열 크기 제한 유틸리티
 * 
 * reflection_notes 필드의 병합 로직과 크기 제한을 처리하는 공통 유틸리티 함수를 제공합니다.
 * remember Tool과 Reflexion Worker에서 공통으로 사용됩니다.
 */

import { logger } from './logger.js';
import { PIIMasker } from './pii-masker.js';
import { validateReflectionNotes, type ReflectionNote } from './reflection-notes-schema.js';

/**
 * 병합 결과 타입
 */
export interface MergeResult {
  merged: ReflectionNote[]; // 병합된 배열
  removedCount: number; // 제거된 항목 수
  warnings: string[]; // 경고 메시지 목록
}

/**
 * 기존 reflection_notes 타입
 */
export type ExistingReflectionNotes =
  | { type: 'null'; value: null }
  | { type: 'object'; value: ReflectionNote }
  | { type: 'array'; value: ReflectionNote[] };

/**
 * 새로 추가할 reflection_notes 타입
 */
export type NewReflectionNotes = string | unknown | unknown[];

/**
 * 단일 객체 최대 크기 (10KB)
 */
const MAX_SINGLE_OBJECT_SIZE = 10 * 1024; // 10KB

/**
 * 전체 필드 최대 크기 (1MB)
 */
const MAX_TOTAL_FIELD_SIZE = 1024 * 1024; // 1MB

/**
 * 배열 최대 크기 (100개)
 */
const MAX_ARRAY_SIZE = 100;

/**
 * 단일 객체 크기 검증
 * 
 * @param obj - 검증할 객체
 * @returns 객체 크기 (바이트)
 */
function getObjectSize(obj: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch (error) {
    // JSON 직렬화 실패 시 안전하게 처리
    return 0;
  }
}

/**
 * 단일 객체 최대 크기 검증
 * 
 * @param obj - 검증할 객체
 * @throws Error - 10KB 초과 시
 */
function validateSingleObjectSize(obj: unknown): void {
  const size = getObjectSize(obj);
  if (size > MAX_SINGLE_OBJECT_SIZE) {
    throw new Error(
      `단일 reflection_notes 객체는 최대 ${MAX_SINGLE_OBJECT_SIZE}바이트(10KB)를 초과할 수 없습니다. 현재 크기: ${size}바이트`
    );
  }
}

/**
 * 배열 크기 제한 적용 (FIFO 방식)
 * 
 * @param array - 제한을 적용할 배열
 * @returns 제한이 적용된 배열과 제거된 항목 수
 */
function limitArraySize(array: ReflectionNote[]): { limited: ReflectionNote[]; removedCount: number } {
  if (array.length <= MAX_ARRAY_SIZE) {
    return { limited: array, removedCount: 0 };
  }

  const removedCount = array.length - MAX_ARRAY_SIZE;
  const limited = array.slice(-MAX_ARRAY_SIZE); // 가장 최근 항목 유지 (FIFO)

  logger.warn('reflection_notes 배열 크기 제한 초과', PIIMasker.maskObject({
    originalSize: array.length,
    maxSize: MAX_ARRAY_SIZE,
    removedCount,
    message: `배열 크기가 ${MAX_ARRAY_SIZE}개를 초과하여 가장 오래된 ${removedCount}개 항목이 제거되었습니다`
  }));

  return { limited, removedCount };
}

/**
 * 전체 필드 크기 검증 및 자동 정리
 * 
 * @param array - 검증할 배열
 * @returns 정리된 배열과 제거된 항목 수
 */
function validateAndCleanupTotalSize(array: ReflectionNote[]): { cleaned: ReflectionNote[]; removedCount: number } {
  const totalSize = getObjectSize(array);

  if (totalSize <= MAX_TOTAL_FIELD_SIZE) {
    return { cleaned: array, removedCount: 0 };
  }

  // 가장 오래된 항목부터 제거 (timestamp 기준으로 정렬)
  const sorted = [...array].sort((a, b) => {
    const timestampA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timestampB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timestampA - timestampB; // 오래된 것부터
  });

  let cleaned = [...array];
  let removedCount = 0;

  // 전체 크기가 1MB 이하가 될 때까지 가장 오래된 항목 제거
  while (getObjectSize(cleaned) > MAX_TOTAL_FIELD_SIZE && cleaned.length > 0) {
    // 가장 오래된 항목 찾기
    const oldestIndex = cleaned.findIndex((item, idx) => {
      const itemTimestamp = item.timestamp ? new Date(item.timestamp).getTime() : 0;
      const oldestTimestamp = sorted[removedCount]?.timestamp 
        ? new Date(sorted[removedCount].timestamp).getTime() 
        : 0;
      return itemTimestamp === oldestTimestamp;
    });

    if (oldestIndex !== -1) {
      cleaned.splice(oldestIndex, 1);
      removedCount++;
    } else {
      // timestamp가 없는 경우 첫 번째 항목 제거
      cleaned.shift();
      removedCount++;
    }
  }

  if (removedCount > 0) {
    logger.warn('reflection_notes 전체 필드 크기 제한 초과', PIIMasker.maskObject({
      originalSize: totalSize,
      maxSize: MAX_TOTAL_FIELD_SIZE,
      removedCount,
      remainingSize: getObjectSize(cleaned),
      message: `전체 필드 크기가 ${MAX_TOTAL_FIELD_SIZE}바이트(1MB)를 초과하여 가장 오래된 ${removedCount}개 항목이 자동으로 제거되었습니다`
    }));
  }

  return { cleaned, removedCount };
}

/**
 * 새로 추가할 reflection_notes를 배열로 변환
 * 
 * @param newNotes - 새로 추가할 reflection_notes (문자열, 객체, 또는 배열)
 * @returns 배열로 변환된 reflection_notes
 */
function normalizeNewReflectionNotes(newNotes: NewReflectionNotes): unknown[] {
  // 문자열인 경우 JSON 파싱
  if (typeof newNotes === 'string') {
    try {
      const parsed = JSON.parse(newNotes);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
      throw new Error(
        `reflection_notes JSON 파싱 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 이미 배열인 경우
  if (Array.isArray(newNotes)) {
    return newNotes;
  }

  // 단일 객체인 경우
  return [newNotes];
}

/**
 * reflection_notes 병합 및 배열 크기 제한
 * 
 * 병합 로직:
 * - NULL → 새로 저장
 * - 단일 객체 → 배열 변환 후 추가
 * - 배열 → 배열에 추가
 * 
 * 크기 제한:
 * - 배열 크기: 최대 100개, 초과 시 FIFO로 가장 오래된 항목 제거
 * - 단일 객체: 최대 10KB, 초과 시 에러 반환
 * - 전체 필드: 최대 1MB, 초과 시 자동 정리 (가장 오래된 항목부터 제거)
 * 
 * @param existing - 기존 reflection_notes (조회 결과)
 * @param newNotes - 새로 추가할 reflection_notes (문자열, 객체, 또는 배열)
 * @returns 병합 결과
 * @throws Error - 단일 객체 크기 초과 시
 */
export function mergeReflectionNotes(
  existing: ExistingReflectionNotes,
  newNotes: NewReflectionNotes
): MergeResult {
  const warnings: string[] = [];
  let removedCount = 0;

  // 새로 추가할 reflection_notes를 배열로 변환
  const newNotesArray = normalizeNewReflectionNotes(newNotes);

  // 각 새 항목의 크기 검증
  for (const item of newNotesArray) {
    try {
      validateSingleObjectSize(item);
    } catch (error) {
      throw error; // 단일 객체 크기 초과는 즉시 에러 반환
    }
  }

  // 새로 들어온 notes 스키마 검증
  const validationTarget =
    newNotesArray.length === 1 ? JSON.stringify(newNotesArray[0]) : JSON.stringify(newNotesArray);
  const validation = validateReflectionNotes(validationTarget);
  if (!validation.isValid) {
    const message = validation.errors
      ?.map((e) => `${e.field}: ${e.message}`)
      .join('; ') ?? 'reflection_notes validation failed';
    throw new Error(`reflection_notes 스키마 검증 실패: ${message}`);
  }

  const validatedNewNotesArray = newNotesArray as ReflectionNote[];

  // 기존 reflection_notes 처리
  let merged: ReflectionNote[];

  if (existing.type === 'null') {
    // NULL → 새로 저장
    merged = validatedNewNotesArray;
  } else if (existing.type === 'object') {
    // 단일 객체 → 배열 변환 후 추가
    merged = [existing.value, ...validatedNewNotesArray];
  } else if (existing.type === 'array') {
    // 배열 → 배열에 추가
    merged = [...existing.value, ...validatedNewNotesArray];
  } else {
    // 예상치 못한 타입
    merged = validatedNewNotesArray;
    warnings.push(`예상치 못한 기존 reflection_notes 타입: ${String((existing as { type?: unknown }).type)}`);
  }

  // 배열 크기 제한 적용
  const sizeLimitResult = limitArraySize(merged);
  merged = sizeLimitResult.limited;
  removedCount += sizeLimitResult.removedCount;
  if (sizeLimitResult.removedCount > 0) {
    warnings.push(
      `배열 크기 제한: ${sizeLimitResult.removedCount}개 항목 제거됨 (최대 ${MAX_ARRAY_SIZE}개)`
    );
  }

  // 전체 필드 크기 검증 및 자동 정리
  const sizeCleanupResult = validateAndCleanupTotalSize(merged);
  merged = sizeCleanupResult.cleaned;
  removedCount += sizeCleanupResult.removedCount;
  if (sizeCleanupResult.removedCount > 0) {
    warnings.push(
      `전체 필드 크기 제한: ${sizeCleanupResult.removedCount}개 항목 제거됨 (최대 ${MAX_TOTAL_FIELD_SIZE}바이트)`
    );
  }

  return {
    merged,
    removedCount,
    warnings
  };
}

/**
 * 병합된 reflection_notes를 JSON 문자열로 변환
 * 
 * @param merged - 병합된 배열
 * @returns JSON 문자열
 */
export function serializeReflectionNotes(merged: ReflectionNote[]): string {
  // 배열이 1개인 경우 단일 객체로 저장 (Phase 1 호환성)
  if (merged.length === 1) {
    return JSON.stringify(merged[0]);
  }

  // 배열인 경우 배열로 저장
  return JSON.stringify(merged);
}

