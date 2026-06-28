/**
 * Remember Tool reflection_notes 처리 (remember-tool.ts에서 분리, #582).
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { mergeReflectionNotes, serializeReflectionNotes, type ExistingReflectionNotes } from '../../../shared/utils/reflection-notes-merge.js';
import { formatValidationErrors, validateReflectionNotes, type ReflectionNote } from '../../../shared/utils/reflection-notes-schema.js';
import type { RememberToolHost } from './remember-tool-host.js';

/** 기존 reflection_notes 조회 결과 타입 */
export interface ExistingReflectionNotesResult {
  exists: boolean;
  type: 'null' | 'object' | 'array';
  value: null | ReflectionNote | ReflectionNote[];
  rawValue: string | null;
}

export function validateReflectionNotesJson(reflectionNotes: string): void {
  const validationResult = validateReflectionNotes(reflectionNotes);
  if (!validationResult.isValid) {
    const errorMessage = formatValidationErrors(validationResult);
    throw new Error(`reflection_notes 스키마 검증 실패:\n${errorMessage}`);
  }
}

export function parseReflectionNotes(
  reflectionNotes: string | null,
  host: RememberToolHost
): ExistingReflectionNotesResult {
  if (!reflectionNotes || reflectionNotes.trim() === '') {
    return { exists: true, type: 'null', value: null, rawValue: null };
  }

  try {
    const parsed = JSON.parse(reflectionNotes);

    if (Array.isArray(parsed)) {
      return { exists: true, type: 'array', value: parsed as ReflectionNote[], rawValue: reflectionNotes };
    }

    if (typeof parsed === 'object' && parsed !== null) {
      return { exists: true, type: 'object', value: parsed as ReflectionNote, rawValue: reflectionNotes };
    }

    return { exists: true, type: 'null', value: null, rawValue: reflectionNotes };
  } catch (error) {
    host.logWarning(`reflection_notes 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
    return { exists: true, type: 'null', value: null, rawValue: reflectionNotes };
  }
}

export async function getExistingReflectionNotes(
  db: Database.Database,
  taskGoal: string | null | undefined,
  host: RememberToolHost
): Promise<ExistingReflectionNotesResult> {
  if (!taskGoal) {
    return { exists: false, type: 'null', value: null, rawValue: null };
  }

  try {
    const existingRecord = DatabaseUtils.get(
      db,
      `SELECT reflection_notes FROM memory_item
       WHERE type = 'procedural' AND task_goal = ?
       ORDER BY created_at DESC LIMIT 1`,
      [taskGoal]
    ) as { reflection_notes?: string | null } | undefined;

    if (!existingRecord || !existingRecord.reflection_notes) {
      return { exists: false, type: 'null', value: null, rawValue: null };
    }

    return parseReflectionNotes(existingRecord.reflection_notes, host);
  } catch (error) {
    host.logWarning(`기존 reflection_notes 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
    return { exists: false, type: 'null', value: null, rawValue: null };
  }
}

export async function prepareReflectionNotes(
  db: Database.Database,
  reflection_notes: string | undefined | null,
  task_goal: string | undefined | null,
  host: RememberToolHost
): Promise<string | null> {
  if (reflection_notes === undefined || reflection_notes === null) {
    return null;
  }

  let finalReflectionNotes = reflection_notes;
  const existingReflectionNotes = await getExistingReflectionNotes(db, task_goal, host);

  if (!existingReflectionNotes.exists) {
    return finalReflectionNotes;
  }

  try {
    const existing: ExistingReflectionNotes =
      existingReflectionNotes.type === 'null' ? { type: 'null', value: null } :
      existingReflectionNotes.type === 'object' ? { type: 'object', value: existingReflectionNotes.value as ReflectionNote } :
      { type: 'array', value: (existingReflectionNotes.value ?? []) as ReflectionNote[] };

    const mergeResult = mergeReflectionNotes(existing, reflection_notes);
    finalReflectionNotes = serializeReflectionNotes(mergeResult.merged);

    if (mergeResult.warnings.length > 0) {
      mergeResult.warnings.forEach(warning => {
        host.logWarning(`reflection_notes 병합 경고: ${warning}`);
      });
    }

    if (mergeResult.removedCount > 0) {
      host.logWarning(`reflection_notes 크기 제한으로 인해 ${mergeResult.removedCount}개 항목이 제거되었습니다`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('최대') && errorMessage.includes('바이트')) {
      throw new Error(
        `reflection_notes 크기 제한 초과: ${errorMessage}. ` +
        `단일 객체는 최대 10KB, 전체 필드는 최대 1MB를 초과할 수 없습니다.`
      );
    }

    host.logWarning(
      `reflection_notes 병합 실패, 원본 값 사용: ${errorMessage}. ` +
      `기존 reflection_notes는 유지되고 새 reflection_notes만 저장됩니다.`
    );
  }

  return finalReflectionNotes;
}
